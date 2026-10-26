# Finances personnelles

Application web personnelle de gestion financière : comptes, opérations
saisies manuellement, transferts, échéances récurrentes, budgets, aides et
tickets-restaurant, objectifs d'épargne, prévisions jour par jour, simulateur
d'achat et analyses mensuelles. Interface en français, en euros, installable
sur iPhone (PWA).

- **Stack** : Next.js 16 (App Router, TypeScript strict), Supabase (PostgreSQL + Auth), CSS Modules, zod, Vitest.
- **Règles de calcul** : [docs/REGLES-COMPTABLES.md](docs/REGLES-COMPTABLES.md).

## Installation

Prérequis : Node.js 20.9 ou plus récent, un projet Supabase gratuit.

1. Installer les dépendances : `npm install`
2. Créer la base : dans Supabase → **SQL Editor**, exécuter **dans l'ordre**
   chacun des fichiers de `supabase/migrations/` (ou `supabase db push` avec la
   CLI Supabase). Chaque nouvelle migration s'exécute une seule fois.
3. Copier `.env.example` en `.env.local` et renseigner :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (clé « publishable » ou « anon »)

   Ne jamais utiliser la clé `service_role` : l'application n'en a pas besoin.
4. Supabase → **Authentication → URL Configuration** :
   - Site URL : `http://localhost:1060` (puis l'URL Vercel en production)
   - Redirect URLs : `http://localhost:1060/auth/confirm` et `https://<votre-app>.vercel.app/auth/confirm`
5. Lancer : `npm run dev` puis ouvrir <http://localhost:1060>.
6. Créer votre compte depuis la page de connexion et confirmer l'e-mail. Pour un
   usage strictement personnel, désactivez ensuite les inscriptions
   (Authentication → Sign In / Providers → « Allow new users to sign up »).

## Commandes

| Commande            | Rôle                                                        |
|---------------------|-------------------------------------------------------------|
| `npm run dev`       | Serveur de développement (port 1060)                        |
| `npm run build`     | Build de production                                         |
| `npm run start`     | Serveur de production local (port 1060)                     |
| `npm run lint`      | ESLint                                                      |
| `npm run typecheck` | Génération des types de routes + vérification TypeScript    |
| `npm test`          | Tests unitaires et d'intégration (base PostgreSQL embarquée) |

Les tests d'intégration rejouent les migrations dans PGlite (PostgreSQL en
WebAssembly) avec un environnement Supabase minimal : ils vérifient les
écritures, les transferts, l'idempotence, l'audit et le cloisonnement RLS entre
utilisateurs, sans compte Supabase.

## Déploiement sur Vercel

1. Pousser le dépôt sur GitHub et l'importer dans Vercel (framework détecté automatiquement).
2. Ajouter les deux variables d'environnement ci-dessus (Production et Preview).
3. Déployer, puis ajouter l'URL Vercel dans la configuration d'authentification Supabase.

## Sécurité

- Authentification Supabase ; chaque requête serveur revérifie l'utilisateur.
- RLS stricte sur toutes les tables ; clés étrangères composites `(user_id, id)`
  empêchant toute référence croisée entre utilisateurs.
- Écritures comptables uniquement via des fonctions SQL atomiques et auditées
  (journal `transaction_audit`) ; tables comptables en lecture seule côté client.
- Protection contre la double soumission (identifiant de requête unique).
- Aucun identifiant bancaire demandé ; aucune donnée saisie dans les journaux.
- Export JSON (sauvegarde complète) et CSV depuis Paramètres ; restauration
  d'une sauvegarde JSON dans un espace vide (tout ou rien, rien n'est écrasé) ;
  suppression de toutes les données avec confirmation.

## Structure

```
supabase/migrations/   Schéma SQL versionné (tables, RLS, RPC, contraintes)
src/lib/domain/        Calculs financiers purs et testés
src/lib/data/          Accès aux données (session, chargement, erreurs)
src/lib/validation/    Schémas zod partagés client/serveur
src/app/actions/       Server Actions (toutes les écritures)
src/app/(app)/         Pages privées
src/components/        Interface (navigation, formulaires, graphiques)
tests/                 Tests unitaires et d'intégration
```

## Limites connues (V1)

- Pas de connexion bancaire automatique (volontaire).
- Pas de saisie hors ligne : l'application signale la perte de connexion ;
  les données restent sur Supabase et sont synchronisées entre appareils.
- La restauration d'une sauvegarde JSON exige un espace vide (pas de fusion) et
  un fichier de 4 Mo au plus (limite des fonctions Vercel).
- Alertes affichées dans l'application, sans notification push.
- Supprimer l'identifiant de connexion lui-même se fait depuis le tableau de bord Supabase.
