import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { requireServerEnv } from "@/lib/env";
import type { Query } from "./sql";
import type { Executor } from "./user-db";

/*
 * Connexion à Neon par HTTP : pas de connexion persistante à gérer sur
 * Vercel, et une transaction complète (rôle + requêtes) = un seul aller-retour.
 * Ce module n'est importable que côté serveur : DATABASE_URL n'est jamais
 * envoyée au navigateur.
 */
let client: NeonQueryFunction<false, false> | null = null;

function getClient() {
  client ??= neon(requireServerEnv().databaseUrl);
  return client;
}

export const neonExecutor: Executor = {
  async transaction(queries: Query[]) {
    const c = getClient();
    return (await c.transaction(queries.map((q) => c.query(q.text, q.values)))) as Record<string, unknown>[][];
  },
};

/**
 * Requête hors contexte utilisateur (rôle de connexion, sans RLS) : réservée à
 * l'authentification (table auth.users). Jamais pour les données financières.
 */
export async function adminQuery(q: Query): Promise<Record<string, unknown>[]> {
  return (await getClient().query(q.text, q.values)) as Record<string, unknown>[];
}
