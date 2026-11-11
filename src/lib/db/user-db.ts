import { raw, sql, type Query } from "./sql";

/**
 * Exécute des requêtes dans UNE transaction et renvoie les lignes de chacune.
 * Implémentations : Neon (src/lib/db/neon.ts) et PGlite (tests).
 */
export type Executor = {
  transaction: (queries: Query[]) => Promise<Record<string, unknown>[][]>;
};

/** Erreur de base de données (code SQLSTATE, message, détail). */
export type DbError = { code?: string; message?: string; details?: string | null };
export type DbResult<T> = { data: T; error: null } | { data: null; error: DbError };

type Row = Record<string, unknown>;

function toDbError(e: unknown): DbError {
  if (e && typeof e === "object") {
    const err = e as { code?: unknown; message?: unknown; detail?: unknown };
    return {
      code: typeof err.code === "string" ? err.code : undefined,
      message: typeof err.message === "string" ? err.message : undefined,
      details: typeof err.detail === "string" ? err.detail : null,
    };
  }
  return { message: String(e) };
}

/*
 * Les lignes sont sérialisées en JSON par PostgreSQL (json_agg) : bigint en
 * nombre, date en "AAAA-MM-JJ", timestamptz en ISO 8601. C'est exactement le
 * format que renvoyait PostgREST (Supabase) : les fonctions de conversion
 * (src/lib/data/mappers.ts) restent inchangées.
 */
const asJsonRows = (q: Query) => sql`select coalesce(json_agg(_r), '[]'::json) as rows from (${q}) _r`;
const asJsonReturning = (q: Query) => sql`with _r as (${q}) select coalesce(json_agg(_r), '[]'::json) as rows from _r`;

function jsonRows(result: Row[] | undefined): Row[] {
  const value = result?.[0]?.rows;
  if (typeof value === "string") return JSON.parse(value) as Row[];
  return (value as Row[] | undefined) ?? [];
}

/**
 * Accès aux données pour un utilisateur : chaque appel est une transaction qui
 * commence par endosser le rôle authenticated et poser l'identifiant de
 * l'utilisateur (lu par auth.uid()). Les politiques RLS et les fonctions SQL
 * filtrent donc chaque ligne : aucune donnée d'un autre utilisateur n'est
 * lisible ni modifiable, même en cas d'oubli d'un filtre dans le code.
 */
export function userDb(executor: Executor, userId: string) {
  const prelude: Query[] = [sql`select set_config('request.jwt.claim.sub', ${userId}, true)`, sql`set local role ${raw("authenticated")}`];

  async function run(queries: Query[]): Promise<DbResult<Row[][]>> {
    try {
      const results = await executor.transaction([...prelude, ...queries]);
      return { data: results.slice(prelude.length), error: null };
    } catch (e) {
      return { data: null, error: toDbError(e) };
    }
  }

  return {
    /** Lignes d'un SELECT. */
    async rows<T = Row>(q: Query): Promise<DbResult<T[]>> {
      const res = await run([asJsonRows(q)]);
      return res.error ? res : { data: jsonRows(res.data[0]) as T[], error: null };
    },
    /** Première ligne d'un SELECT, ou null. */
    async row<T = Row>(q: Query): Promise<DbResult<T | null>> {
      const res = await run([asJsonRows(q)]);
      return res.error ? res : { data: (jsonRows(res.data[0])[0] as T | undefined) ?? null, error: null };
    },
    /** Lignes renvoyées par un INSERT/UPDATE/DELETE … RETURNING. */
    async returning<T = Row>(q: Query): Promise<DbResult<T[]>> {
      const res = await run([asJsonReturning(q)]);
      return res.error ? res : { data: jsonRows(res.data[0]) as T[], error: null };
    },
    /** Instruction sans résultat attendu. */
    async exec(q: Query): Promise<DbResult<null>> {
      const res = await run([q]);
      return res.error ? res : { data: null, error: null };
    },
    /** Plusieurs SELECT dans une même transaction (un seul aller-retour). */
    async batch(queries: Query[]): Promise<DbResult<Row[][]>> {
      const res = await run(queries.map(asJsonRows));
      return res.error ? res : { data: res.data.map(jsonRows), error: null };
    },
  };
}

export type UserDb = ReturnType<typeof userDb>;
