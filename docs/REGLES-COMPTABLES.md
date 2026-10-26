# Règles comptables et définitions

Ce document fixe les règles appliquées partout dans l'application. Chaque règle
est implémentée dans une fonction pure de `src/lib/domain/` et couverte par les
tests de `tests/unit/` ; les invariants comptables sont en outre revérifiés par
la base de données (`supabase/migrations/`).

## 1. Montants

- Tous les montants sont des **centimes entiers** (`bigint` en base, entier en
  TypeScript). Aucun calcul n'utilise de nombre flottant ; la division par 100
  n'a lieu qu'à l'affichage.
- Un montant est **toujours saisi positif**. Le type de mouvement donne le sens.
- Devise unique en V1 : l'euro.

## 2. Opérations et écritures (partie double)

Une **opération** est l'événement saisi (libellé, date, montant, type, statut,
catégorie). Ses effets sur les comptes sont des **écritures** signées :

| Type        | Écritures                                                    | Somme      |
|-------------|--------------------------------------------------------------|------------|
| Dépense     | une ou plusieurs écritures négatives                         | −montant   |
| Revenu      | une ou plusieurs écritures positives                         | +montant   |
| Transfert   | exactement deux écritures opposées (source −, destination +) | 0          |
| Ajustement  | une écriture, dans le sens choisi                            | ±montant   |

La base refuse toute opération dont les écritures ne respectent pas ce tableau
(contrainte différée `check_transaction_integrity`). Les écritures ne sont
modifiables que par les fonctions `save_transaction`, `set_transaction_status`
et `delete_transaction`, atomiques et auditées.

## 3. Statuts

- **Confirmée** : l'opération a eu lieu. Elle compte dans les soldes et les analyses.
  Elle ne peut pas être datée dans le futur.
- **Prévue** : elle n'a aucun effet sur les soldes ni sur les analyses ; elle
  alimente uniquement les prévisions.
- **Annulée** : conservée pour l'historique, sans aucun effet.

## 4. Comptes et soldes

- Le **solde initial** est le solde au **début** du jour de référence, avant
  toute opération datée de ce jour.
- **Solde** = solde initial + écritures **confirmées** datées du jour de
  référence ou après. Les opérations antérieures restent visibles et comptent
  dans les analyses mensuelles, mais n'affectent pas le solde (elles sont
  réputées incluses dans le solde initial) : aucune double comptabilisation.
- Aucun solde n'est stocké : il est toujours recalculé à partir de l'historique.
- Un solde se corrige par un **ajustement** explicite (écart entre le solde
  calculé et le solde constaté), jamais par une modification silencieuse.
  Le solde initial d'un compte déjà utilisé n'est plus modifiable.
- Un compte archivé conserve son historique mais ne reçoit plus de nouvelle opération.

### Classes de comptes

Chaque compte a une **nature** (Livret A, PEA, crédit immobilier…, liste dans
`src/lib/domain/account-kinds.ts`) qui détermine son **type**, donc sa classe :

| Type (exemples de natures)                                        | Classe             | Compté dans              |
|-------------------------------------------------------------------|--------------------|--------------------------|
| Compte courant (joint, secondaire, pro, PayPal, paiement mobile)  | Disponible         | Disponible, total        |
| Espèces (carte prépayée, portefeuille électronique)               | Disponible         | Disponible, total        |
| Livret d'épargne (Livret A, LDDS, LEP, Livret Jeune, PEL, CEL, compte à terme) | Épargne | Épargne, total        |
| Épargne spécifique (objectif personnel)                           | Épargne            | Épargne, total           |
| Autre réserve (cagnotte, cashback, compte personnalisé)           | Réserve            | Total uniquement         |
| Placement (CTO, PEA, assurance-vie, PER, crypto, actions, obligations, financement participatif) | Placements | Total uniquement |
| Crédit ou dette (immobilier, consommation, prêt étudiant, dette personnelle) | Dettes  | Patrimoine net uniquement |
| Tickets-restaurant                                                | Ressource affectée | Ni disponible, ni total  |
| Avantage affecté (carte cadeau, avoirs, chèques-vacances, titres de transport, avantages salariés) | Ressource affectée | Ni disponible, ni total |

- **Placements** : la valeur fluctue. Elle se met à jour par un ajustement
  (écart entre valeur calculée et valeur constatée), jamais compté comme revenu
  ou dépense.
- **Dettes** : solde ≤ 0 (montant restant dû, saisi en positif). Un
  remboursement est un **transfert** du compte courant vers la dette (le
  patrimoine net ne change pas, le disponible baisse) ; intérêts et frais sont
  des dépenses. Une dette n'est jamais comptée comme de l'argent disponible.
- **Découvert** : pas de compte séparé. C'est le solde négatif d'un compte
  courant ; un compte « découvert » le compterait deux fois.
- **Avantages affectés** : comme les tickets-restaurant, ils paient des
  dépenses mais ne peuvent faire l'objet d'aucun transfert.
- Un compte qui a des opérations garde sa **classe** : seule sa nature peut
  changer au sein de la même classe (ex. Livret d'épargne → Livret A). Il ne
  peut jamais devenir ni cesser d'être une dette, un portefeuille de tickets ou
  un avantage affecté. Sinon, l'archiver et créer un nouveau compte.

Règles par type (fonction `accountTypeRules`, vérifiée par les tests contre
les totaux calculés) :

| Type               | Disponible | Épargne | Total des soldes | Patrimoine net | Solde négatif | Virements |
|--------------------|:----------:|:-------:|:----------------:|:--------------:|---------------|:---------:|
| Compte courant     | oui        | non     | oui              | oui            | autorisé      | oui       |
| Espèces            | oui        | non     | oui              | oui            | interdit      | oui       |
| Livret / épargne   | non        | oui     | oui              | oui            | autorisé      | oui       |
| Autre réserve      | non        | non     | oui              | oui            | autorisé      | oui       |
| Placement          | non        | non     | oui              | oui            | autorisé      | oui       |
| Crédit ou dette    | non        | non     | non              | oui (en moins) | toujours      | oui       |
| Tickets-restaurant | non        | non     | non              | non            | interdit      | non       |
| Avantage affecté   | non        | non     | non              | non            | interdit      | non       |

## 5. Indicateurs

Le tableau de bord se limite à l'argent disponible (avec le reste à vivre),
l'épargne totale, le résumé du mois, les dépenses par catégorie et les
mouvements à venir. Total des soldes, dettes et ressources affectées sont sur
la page Comptes ; réservé aux échéances et reste à vivre détaillés sur la page
Prévisions.

- **Total des soldes** = disponible + épargne + réserves + placements (hors
  ressources affectées et dettes).
- **Dettes** = somme des soldes des crédits et dettes (≤ 0) ; **patrimoine net**
  = total des soldes + dettes.
- **Argent disponible** = soldes des comptes courants et espèces.
- **Épargne totale** = soldes des livrets et comptes d'épargne spécifique.
- **Affecté aux objectifs** : part des soldes réservée aux objectifs, jamais ajoutée.
- **Réservé aux échéances** = sorties programmées sur le disponible (échéances
  récurrentes non réalisées + opérations prévues) d'aujourd'hui jusqu'à la veille
  du prochain revenu **certain**, ou sur 30 jours s'il n'y en a pas.
- **Reste jusqu'au prochain revenu** = disponible − réservé − réserve de sécurité.
- **Revenus / dépenses du mois** = opérations confirmées du mois calendaire.
- Chaque tuile indique sa nature : *Constaté*, *Estimé* ou *Prévision*.

## 6. Transferts

Un transfert entre deux comptes personnels n'est **jamais** un revenu, une
dépense ou une économie. Il ne change pas le total des soldes. Il réduit le
disponible s'il part vers l'épargne (et inversement). Les transferts vers ou
depuis un portefeuille de tickets-restaurant sont interdits.

## 7. Tickets-restaurant

- Le crédit du portefeuille est un **revenu** (catégorie « Tickets-restaurant
  (crédits) »), versé sur le compte de tickets.
- Une dépense peut être payée en partie en tickets : une seule opération,
  montant total, avec une écriture sur le compte bancaire (part carte) et une
  sur le portefeuille (part tickets). La banque n'est débitée que de sa part.
- Les analyses affichent la dépense totale et précisent « dont X € en tickets ».
- L'éligibilité d'un achat aux tickets n'est jamais supposée : c'est un choix de saisie.

## 8. Récurrences et échéances

- Les occurrences sont calculées, pas stockées. Les échéances mensuelles gardent
  le jour de la date de début, borné à la fin du mois (31 → 28/29/30).
- **Réaliser** une échéance crée une opération liée `(règle, date prévue)`,
  unique en base : impossible de l'enregistrer deux fois. Le montant réel peut
  différer de l'estimation, conservée à part (`expected_amount_cents`).
- **Ignorer** une échéance crée une opération annulée liée (trace conservée).
- Une échéance passée non enregistrée est « à confirmer » ; elle n'est jamais
  comptée comme effectuée. Les échéances antérieures à la date de **début de
  suivi** de la règle sont « hors suivi » (réputées incluses dans les soldes initiaux).
- Modifier une règle ne réécrit jamais l'historique ; l'option « appliquer à
  partir du » arrête la règle la veille et crée une nouvelle règle.

## 9. Budgets

- Périodes calendaires : semaine du **lundi au dimanche**, mois calendaire.
- **Dépensé** = dépenses confirmées de la catégorie dans la période (montant
  total, tickets compris). Chaque opération n'appartient qu'à une catégorie et
  une période.
- **Programmé** = opérations prévues + échéances non réalisées de la catégorie
  dans la période, affiché séparément.
- **Projection** = max(dépensé + programmé, rythme actuel prolongé à la fin de la période).
- Alerte à partir du seuil (80 % par défaut), dépassement au-delà de 100 %.

## 10. Revenus estimés et certitude

Chaque revenu récurrent a un niveau de certitude :

- **Certain** : compté dans tous les scénarios ;
- **Probable** : compté uniquement dans le scénario « estimé » ;
- **Incertain** : jamais compté, seulement affiché.

Un revenu ponctuel « prévu » est considéré comme probable. Les sorties d'argent
sont toujours comptées (prudence).

## 11. Prévisions

Le solde **disponible** est projeté jour par jour, dans l'ordre chronologique,
à partir du disponible constaté aujourd'hui et des mouvements à venir (effet sur
le disponible uniquement). Les échéances passées non confirmées sont reportées
à aujourd'hui. Option « préserver les budgets » : pour chaque période, l'enveloppe
restante (budget − dépensé − déjà programmé, jamais négative) est réservée au
début de la période ; si une catégorie a un budget hebdomadaire et mensuel,
seul l'hebdomadaire est utilisé.

## 12. Simulateur d'achat

Un achat de prix P à la date D est :

- **compatible** si, dans le scénario garanti, le disponible reste ≥ réserve de
  sécurité chaque jour de [D ; D + 62 jours] après déduction de P ;
- **possible avec marge réduite** s'il reste ≥ 0 mais entame la réserve, ou s'il
  n'est compatible qu'avec les revenus probables ;
- **à reporter** sinon ; la première date compatible dans les 12 mois est proposée ;
- **impossible à établir** sans compte disponible, au-delà de l'horizon, ou si
  aucun revenu certain n'est programmé et qu'aucune date ne convient.

C'est une aide à la décision budgétaire, pas une garantie de solvabilité.

## 12 bis. Calendrier d'une liste d'achats (page « Achats planifiés »)

Pour une liste d'achats (ex. équiper un logement non meublé), les achats sont
traités par **priorité**, puis **date limite**, puis date « pas avant », puis
ordre de saisie. Chacun est placé au **premier jour** où le disponible des
comptes courants (scénario garanti) reste ≥ réserve de sécurité :

- sur les 62 jours suivant cet achat ;
- et jusqu'à la fin des fenêtres de contrôle des achats déjà placés.

Les achats sont **cumulés** : la même marge n'est jamais comptée deux fois, et un
nouvel achat ne peut pas compromettre un achat précédent. Un achat placé après
sa date limite est signalé, avec la somme qui manquerait pour l'acheter à cette
date. Un achat sans date possible dans les 12 mois est « hors de portée ».
Les livrets ne sont jamais utilisés. Confirmer la dépense correspondante retire
l'achat de la liste.

## 12 ter. Virements conseillés entre comptes courants

Chaque compte courant est projeté séparément sur la période à venir (scénario
garanti, achats planifiés compris sur la page Achats). Si un compte passerait à
découvert, un virement est proposé depuis le compte courant qui garde la plus
grande marge, sans jamais rendre ce dernier négatif. Le montant est arrondi aux
10 € supérieurs quand c'est possible, et le virement est à faire au plus tard la
veille du découvert prévu. Si aucun compte ne peut couvrir le manque, une alerte
le signale. Les enveloppes budgétaires et les achats sans compte précisé sont
imputés au **compte de dépenses courantes** choisi dans les Paramètres.

## 12 quater. Saisie rapide, doublons et sauvegardes

- **Saisie rapide** : les opérations confirmées répétées au moins deux fois sur
  120 jours (même type, libellé, catégorie et compte, hors échéances
  récurrentes) sont proposées comme modèles, avec le dernier montant saisi.
- **Doublons possibles** : opérations non annulées de même type, date, montant,
  libellé (casse ignorée), note et écritures, sur 90 jours. Un simple
  signalement : rien n'est supprimé automatiquement ; une note distingue deux
  opérations identiques légitimes.
- **Restauration** : une sauvegarde JSON est revérifiée champ par champ, puis
  importée en une seule transaction SQL, uniquement dans un espace vide, avec de
  nouveaux identifiants ; au moindre écart (écritures déséquilibrées, référence
  manquante), rien n'est importé.

## 13. Objectifs d'épargne

Un objectif **affecte** une partie de l'argent déjà présent : il ne s'ajoute
jamais aux soldes. Suivi « compte dédié » : accumulé = solde du compte (≥ 0).
Suivi « manuel » : accumulé = somme des affectations. Une alerte signale des
affectations supérieures au solde du compte associé.

- Progression = accumulé / cible ; reste = max(0, cible − accumulé).
- Nécessaire par mois = reste / mois entiers jusqu'à la date cible (minimum 1).
- Date estimée = aujourd'hui + ⌈reste / contribution mensuelle⌉ mois.

## 14. Analyses mensuelles

- Revenus, dépenses : opérations confirmées du mois ; transferts et ajustements exclus.
- Solde net = revenus − dépenses ; taux d'épargne = solde net / revenus
  (non calculable si revenus nuls).
- **Différence** = montant actuel − montant de référence ; **variation %** =
  différence / référence × 100, seulement si la référence est > 0. Sinon :
  « Nouvelle dépense » / « Nouveau revenu » (référence nulle) ou « Non calculable ».
- Références possibles : mois précédent complet, même période du mois précédent
  (mois en cours, du 1er au même jour), moyenne des mois renseignés sur N mois.
- Le mois en cours est marqué **provisoire**. Les échéances attendues mais non
  comptabilisées, ou comptabilisées un autre mois, sont signalées pour ne pas
  confondre un prélèvement décalé avec une économie.
- Évolution de l'épargne : variation réelle = soldes initiaux de nouveaux comptes
  + versements nets (transferts depuis/vers des comptes hors épargne) + intérêts
  + autres revenus − dépenses payées par l'épargne + ajustements.
- Le bilan automatique n'émet que des constats calculés (règles et seuils dans
  `src/lib/domain/insights.ts`).

## 15. Dates

Les dates d'opération sont des jours civils (`AAAA-MM-JJ`). Le « jour courant »
est déterminé dans le fuseau **Europe/Paris** ; toute l'arithmétique de dates se
fait en UTC pur pour éviter les décalages d'heure d'été.
