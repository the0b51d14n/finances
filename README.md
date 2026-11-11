# Finances personnelles

Application web personnelle de gestion financière : comptes, opérations
saisies manuellement, transferts, échéances récurrentes, budgets, aides et
tickets-restaurant, objectifs d'épargne, prévisions jour par jour, simulateur
d'achat et analyses mensuelles. Interface en français, en euros, installable
sur iPhone (PWA).

- **Stack** : Next.js 16 (App Router, TypeScript strict), Neon PostgreSQL (pilote `@neondatabase/serverless`, sans ORM), CSS Modules, zod, Vitest.
- **Règles de calcul** : [docs/REGLES-COMPTABLES.md](docs/REGLES-COMPTABLES.md).

```text
Navigateur ──(cookie de session signé)──▶ Next.js sur Vercel ──DATABASE_URL (serveur)──▶ Neon PostgreSQL
```

## Installation

Prérequis : Node.js 22.18 ou plus récent (les scripts sont en TypeScript), un projet Neon gratuit.

1. Installer les dépendances : `npm install`
2. Créer un projet sur [Neon](https://neon.tech) (région conseillée : *AWS Europe Central 1 – Frankfurt*,
   la même que les fonctions Vercel, voir `vercel.json`).
3. Copier `.env.example` en `.env.local` et renseigner :
   - `DATABASE_URL` : chaîne de connexion Neon (« Pooled connection ») ;
   - `AUTH_SECRET` : valeur aléatoire de 32 caractères minimum (commande dans `.env.example`).
4. Créer le schéma : `npm run db:migrate` (applique dans l'ordre les fichiers de
   `db/migrations/` pas encore appliqués ; peut être relancé sans risque).
5. Créer votre utilisateur : `npm run user:create` (e-mail + mot de passe saisis
   dans le terminal). Relancer la commande avec le même e-mail change le mot de passe.
6. Lancer : `npm run dev` puis ouvrir <http://localhost:1060>.

## Commandes

| Commande              | Rôle                                                        |
|-----------------------|-------------------------------------------------------------|
| `npm run dev`         | Serveur de développement (port 1060)                        |
| `npm run build`       | Build de production                                         |
| `npm run start`       | Serveur de production local (port 1060)                     |
| `npm run lint`        | ESLint                                                      |
| `npm run typecheck`   | Génération des types de routes + vérification TypeScript    |
| `npm test`            | Tests unitaires et d'intégration (base PostgreSQL embarquée) |
| `npm run db:migrate`  | Applique les migrations en attente à la base Neon           |
| `npm run user:create` | Crée l'utilisateur ou change son mot de passe               |

Les tests d'intégration rejouent les migrations dans PGlite (PostgreSQL en
WebAssembly) et exécutent la couche d'accès de l'application (même rôle, même
RLS qu'en production) : ils vérifient les écritures, les transferts,
l'idempotence, l'audit et le cloisonnement entre utilisateurs, sans compte Neon.

## Déploiement sur Vercel

1. Pousser le dépôt sur GitHub et l'importer dans Vercel (framework détecté automatiquement).
2. Ajouter `DATABASE_URL` et `AUTH_SECRET` dans les variables d'environnement
   (Production et Preview). Alternative : intégration Neon de la marketplace
   Vercel, qui renseigne `DATABASE_URL` automatiquement.
3. Déployer. Les migrations s'appliquent depuis votre poste (`npm run db:migrate`), pas au build.

## Sécurité

- Connexion par e-mail et mot de passe (haché avec scrypt) ; verrouillage de
  15 minutes après 5 échecs ; pas d'inscription publique (`npm run user:create`).
- Session : cookie signé (HMAC-SHA256), `HttpOnly`, `SameSite=Lax`, `Secure` en
  production, valable 30 jours. La déconnexion supprime le cookie ; changer
  `AUTH_SECRET` invalide toutes les sessions.
- La base n'est jamais accessible depuis le navigateur : `DATABASE_URL` n'est
  lue que par le serveur, aucune variable `NEXT_PUBLIC_`.
- Chaque requête s'exécute dans une transaction sous le rôle `authenticated`
  avec l'identifiant de l'utilisateur : RLS stricte sur toutes les tables ;
  clés étrangères composites `(user_id, id)` empêchant toute référence croisée
  entre utilisateurs.
- Requêtes toujours paramétrées (`src/lib/db/sql.ts`) : aucune donnée saisie
  n'est concaténée au texte SQL.
- Écritures comptables uniquement via des fonctions SQL atomiques et auditées
  (journal `transaction_audit`) ; tables comptables en lecture seule pour l'application.
- Protection contre la double soumission (identifiant de requête unique).
- Aucun identifiant bancaire demandé ; aucune donnée saisie dans les journaux.
- Export JSON (sauvegarde complète) et CSV depuis Paramètres ; restauration
  d'une sauvegarde JSON dans un espace vide (tout ou rien, rien n'est écrasé) ;
  suppression de toutes les données avec confirmation.

## Structure

```
db/migrations/         Schéma SQL versionné (auth, tables, RLS, fonctions, contraintes)
scripts/               Migrations et création de l'utilisateur
src/lib/domain/        Calculs financiers purs et testés
src/lib/db/            Accès PostgreSQL (requêtes paramétrées, transaction par utilisateur)
src/lib/auth/          Mot de passe, jeton et cookie de session
src/lib/data/          Session, chargement des données, erreurs
src/lib/validation/    Schémas zod partagés client/serveur
src/app/actions/       Server Actions (toutes les écritures)
src/app/(app)/         Pages privées
src/components/        Interface (navigation, formulaires, graphiques)
tests/                 Tests unitaires et d'intégration
```

## Limites connues (V1)

- Pas de connexion bancaire automatique (volontaire).
- Pas de saisie hors ligne : l'application signale la perte de connexion ;
  les données restent sur Neon et sont synchronisées entre appareils.
- La restauration d'une sauvegarde JSON exige un espace vide (pas de fusion) et
  un fichier de 4 Mo au plus (limite des fonctions Vercel).
- Alertes affichées dans l'application, sans notification push.
- Pas de « mot de passe oublié » : relancer `npm run user:create` avec le même e-mail.
- En offre gratuite, Neon met la base en veille après 5 minutes d'inactivité ;
  elle se réveille seule à la requête suivante (moins d'une seconde).
