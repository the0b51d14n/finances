/**
 * Banc d'essai PostgreSQL pour les tests d'intégration.
 *
 * Démarre un PostgreSQL embarqué (PGlite) et applique les migrations du dépôt
 * dans l'ordre (la première crée auth.users, auth.uid() et les rôles). Les
 * requêtes « utilisateur » s'exécutent sous le rôle authenticated avec
 * l'identifiant posé dans request.jwt.claim.sub, donc sous RLS, exactement
 * comme l'application (src/lib/db/user-db.ts).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

export type TestDb = {
  db: PGlite;
  /** Crée un utilisateur auth et initialise ses données par défaut. */
  createUser: () => Promise<string>;
  /** Exécute une requête en tant qu'utilisateur authentifié (RLS active). */
  asUser: <T = Record<string, unknown>>(
    userId: string,
    sql: string,
    params?: unknown[],
  ) => Promise<T[]>;
  /** Exécute une requête en tant qu'administrateur (hors RLS). */
  admin: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
};

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  const admin = async <T,>(sql: string, params: unknown[] = []) => {
    const res = await db.query<T>(sql, params);
    return res.rows;
  };

  const asUser = async <T,>(userId: string, sql: string, params: unknown[] = []) => {
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`,
    );
    try {
      const res = await db.query<T>(sql, params);
      return res.rows;
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  };

  const createUser = async () => {
    const [{ id }] = await admin<{ id: string }>(
      "insert into auth.users (email, password_hash) values ('u-' || gen_random_uuid() || '@test.local', 'x') returning id",
    );
    await asUser(id, "select public.ensure_user_setup()");
    return id;
  };

  return { db, admin, asUser, createUser };
}
