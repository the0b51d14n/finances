# Règles comptables et définitions

Ce document fixe les règles appliquées partout dans l'application. Chaque règle
est implémentée dans une fonction pure de `src/lib/domain/` et couverte par les
tests de `tests/unit/` ; les invariants comptables sont en outre revérifiés par
la base de données (`db/migrations/`).

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

Il n'existe **aucune étape de confirmation** : le statut découle de la date.

- **Effectuée** (`confirmed`) : date aujourd'hui ou passée ; compte dans les soldes.
- **À venir** (`planned`) : date future ; aucun effet sur les soldes. Dès que sa
  date est atteinte, elle devient effectuée toute seule, à sa date.
- **Annulée** (`cancelled`) : échéance récurrente supprimée ; conservée pour ne
  pas être recréée, sans aucun effet.

## 4. Comptes et soldes

- Le **solde initial** est le solde au **début** du jour de référence, avant
  toute opération datée de ce jour.
- **Solde** = solde initial + écritures **effectuées** datées du jour de
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

## 5. Indicateurs du tableau de bord

- **Total possédé** = somme des soldes de tous les comptes actifs : disponible,
  épargne, réserves, placements et ressources affectées (cartes cadeaux…),
  dettes déduites. Les comptes archivés n'y figurent pas.
- **Épargne** = soldes des livrets et comptes d'épargne spécifique (Livret A,
  Livret Jeune…).
- **Salaires** : deux lignes fixes, « Salaire alternance » et « Salaire Auchan ».
  Le montant saisi est enregistré comme un revenu effectué du jour, crédité sur
  le compte courant secondaire (à défaut, le premier compte courant). Le montant
  affiché est la somme reçue sur le mois en cours pour cette ligne.
- **Dépenses à venir** : calendrier du mois en cours, en lecture seule, qui ne
  montre que les dépenses futures (opérations à venir et prochaines échéances des
  dépenses récurrentes). La saisie et la suppression se font dans l'onglet
  Calendrier.

Pour les tickets-restaurant, cartes cadeaux et bons d'achat, une dépense ne peut
pas dépasser le solde restant.

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

## 8. Dépenses et virements récurrents, calendrier

- Une dépense ou un virement se saisit **une fois** (à une date, passée ou
  future) ou **répété** : chaque semaine (jour de la semaine choisi), chaque mois
  (numéro du jour, borné à la fin du mois : le 31 devient le 30 ou le 28) ou
  chaque année (date choisie, reportée à l'année suivante si elle est passée).
- **Aucun report** : une échéance tombe exactement au jour prévu, même un
  samedi, un dimanche, un jour férié ou un jour de fermeture de la banque.
- Chaque échéance est enregistrée **toute seule** comme effectuée dès que sa
  date est atteinte (au chargement de l'application), une seule fois. Supprimer
  une échéance l'annule ; « Arrêter » une récurrence supprime les échéances
  futures et garde les passées.
- Les revenus récurrents ne sont jamais enregistrés automatiquement : les
  salaires se saisissent à la main sur le tableau de bord.
- Le **calendrier** montre, pour le mois choisi, chaque dépense, virement et
  revenu à sa date (hors ajustements et opérations annulées), ainsi que les
  échéances futures des récurrences.
- Un **virement** ne change pas le total possédé. Les tickets-restaurant et
  avantages affectés ne peuvent être ni source ni destination d'un virement.

## 9. Opérations (dépenses non prévues)

L'onglet Opérations liste, mois par mois, les dépenses **non prévues** : effectuées,
ponctuelles (sans récurrence) et saisies le jour même ou après leur date (courses,
facture d'électricité…). Une dépense programmée à l'avance dans le calendrier,
ou une échéance récurrente, n'y figure pas. Toutes restent visibles dans le
calendrier à leur date et comptent dans les soldes.

### Payer avec plusieurs comptes

Une dépense non prévue peut être réglée par plusieurs comptes : le **compte qui
paie** règle le reste, chaque **autre moyen de paiement** règle sa part.

- Compte courant, espèces, carte cadeau, bon d'achat, tickets, cagnotte : la
  part est prise directement sur le compte.
- **Livret ou épargne** (Livret A, Livret Jeune…) : un livret ne paie pas
  directement. Sa part fait l'objet d'un **virement** du livret vers le compte
  qui paie, à la même date, puis le compte qui paie règle la dépense (chemin de
  l'argent). Le virement apparaît dans le calendrier et est supprimé avec la
  dépense.
- Aucun compte ne peut sortir plus que son solde pour une carte cadeau, un bon
  d'achat, des tickets ou un livret.
- Une **carte cadeau ou un bon d'achat à 0 €** est retiré automatiquement : il
  n'apparaît plus nulle part (comptes, listes de paiement, total). Il n'est pas
  effacé de la base, car les dépenses payées avec en dépendent.

Dans les listes, chaque compte est affiché avec sa nature et son solde
(« BZB · Carte cadeau · 20,00 € »), regroupé par banque.

## 10. Dates

Les dates d'opération sont des jours civils (`AAAA-MM-JJ`). Le « jour courant »
est déterminé dans le fuseau **Europe/Paris** ; toute l'arithmétique de dates se
fait en UTC pur pour éviter les décalages d'heure d'été.
