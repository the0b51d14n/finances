/**
 * Banc d'essai PostgreSQL pour les tests d'intégration.
 *
 * Démarre un PostgreSQL embarqué (PGlite), recrée le strict nécessaire de
 * l'environnement Supabase (schéma auth, auth.uid(), rôles anon/authenticated
 * et leurs privilèges par défaut), puis applique les migrations du dépôt dans
 * l'ordre. Les requêtes « utilisateur » s'exécutent sous le rôle authenticated
 * avec le JWT simulé, donc sous RLS, exactement comme via PostgREST.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const SUPABASE_BOOTSTRAP = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

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
  await db.exec(SUPABASE_BOOTSTRAP);

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
      "insert into auth.users (id) values (gen_random_uuid()) returning id",
    );
    await asUser(id, "select public.ensure_user_setup()");
    return id;
  };

  return { db, admin, asUser, createUser };
}
