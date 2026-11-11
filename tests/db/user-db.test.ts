/**
 * Couche d'accès aux données de l'application (src/lib/db/user-db.ts),
 * exécutée sur un vrai PostgreSQL (PGlite) avec les migrations du dépôt :
 * mêmes requêtes et même mécanisme (rôle authenticated + RLS) qu'avec Neon.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { dbErrorMessage } from "@/lib/data/errors";
import { toAccount, toSettings, toTransaction } from "@/lib/data/mappers";
import { DATA_QUERIES } from "@/lib/data/queries";
import { deleteById, insertInto, sql, updateWhere } from "@/lib/db/sql";
import { userDb, type Executor, type UserDb } from "@/lib/db/user-db";
import { createTestDb, type TestDb } from "./harness";

/** Exécuteur PGlite : même contrat que l'exécuteur Neon (une transaction). */
function pgliteExecutor(db: PGlite): Executor {
  return {
    transaction: (queries) =>
      db.transaction(async (tx) => {
        const out: Record<string, unknown>[][] = [];
        for (const q of queries) out.push((await tx.query<Record<string, unknown>>(q.text, q.values)).rows);
        return out;
      }),
  };
}

let t: TestDb;
let alice: UserDb;
let bob: UserDb;
let aliceAccount: string;

beforeAll(async () => {
  t = await createTestDb();
  const exec = pgliteExecutor(t.db);
  alice = userDb(exec, await t.createUser());
  bob = userDb(exec, await t.createUser());

  const { data, error } = await alice.returning(
    insertInto(
      "accounts",
      { name: "Compte courant", type: "checking", opening_balance_cents: 150_000, opening_balance_date: "2026-01-01" },
      "id",
    ),
  );
  expect(error).toBeNull();
  aliceAccount = String(data![0].id);
});

describe("accès aux données sous l'identité de l'utilisateur", () => {
  it("lit, modifie et supprime ses propres lignes", async () => {
    const created = await alice.returning(insertInto("budgets", { category_id: null, period: "month", amount_cents: 1, alert_pct: 80, is_active: true }, "id"));
    // Un budget exige une catégorie : l'erreur SQL est renvoyée, pas levée.
    expect(created.error?.code).toBe("23502");

    const upd = await alice.exec(updateWhere("accounts", { notes: "note" }, "id", aliceAccount));
    expect(upd.error).toBeNull();
    const { data } = await alice.row(sql`select notes from public.accounts where id = ${aliceAccount}`);
    expect(data).toEqual({ notes: "note" });
  });

  it("ne voit ni ne modifie jamais les données d'un autre utilisateur", async () => {
    expect((await bob.rows(sql`select id from public.accounts`)).data).toEqual([]);
    expect((await bob.row(sql`select id from public.accounts where id = ${aliceAccount}`)).data).toBeNull();

    await bob.exec(updateWhere("accounts", { name: "piraté" }, "id", aliceAccount));
    await bob.exec(deleteById("accounts", aliceAccount));
    const { data } = await alice.row(sql`select name from public.accounts where id = ${aliceAccount}`);
    expect(data).toEqual({ name: "Compte courant" });
  });

  it("refuse d'écrire pour le compte d'un autre et les écritures comptables directes", async () => {
    const otherUser = await alice.row<{ id: string }>(sql`select auth.uid() as id`);
    const forged = await bob.exec(insertInto("accounts", { user_id: otherUser.data!.id, name: "x", type: "checking" }));
    expect(forged.error?.code).toBe("42501");

    const direct = await alice.exec(insertInto("transactions", { kind: "expense", status: "confirmed", date: "2026-01-02", label: "x", amount_cents: 1 }));
    expect(direct.error?.code).toBe("42501");
    expect(dbErrorMessage(direct.error)).toBe("Accès refusé.");
  });

  it("n'a aucun accès à la table des utilisateurs (mots de passe)", async () => {
    const res = await alice.rows(sql`select * from auth.users`);
    expect(res.error?.code).toBe("42501");
  });
});

describe("format des données (identique à l'ancien PostgREST)", () => {
  it("renvoie bigint en nombre, date en AAAA-MM-JJ, horodatage ISO", async () => {
    const { data } = await alice.row(sql`select opening_balance_cents, opening_balance_date, created_at from public.accounts where id = ${aliceAccount}`);
    expect(data!.opening_balance_cents).toBe(150_000);
    expect(data!.opening_balance_date).toBe("2026-01-01");
    expect(String(data!.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("lecture complète de l'application (loadFinanceData)", () => {
  it("charge tout en une transaction, opérations avec leurs écritures", async () => {
    const category = await alice.row<{ id: string }>(sql`select id from public.categories where kind = 'expense' limit 1`);
    const save = await alice.row<{ id: string }>(sql`select public.save_transaction(${{
      kind: "expense",
      status: "confirmed",
      date: "2026-01-05",
      label: "Courses",
      amount_cents: 4_250,
      category_id: category.data!.id,
      entries: [{ account_id: aliceAccount, amount_cents: -4_250 }],
    }}::jsonb) as id`);
    expect(save.error).toBeNull();

    const res = await alice.batch(DATA_QUERIES);
    expect(res.error).toBeNull();
    const [[settings], accounts, categories, transactions] = res.data!;
    expect(toSettings(settings).currency).toBe("EUR");
    expect(accounts.map(toAccount).map((a) => a.name)).toEqual(["Compte courant"]);
    expect(categories.length).toBeGreaterThan(0);
    const tx = transactions.map(toTransaction).find((x) => x.id === save.data!.id)!;
    expect(tx).toMatchObject({ label: "Courses", amountCents: 4_250, date: "2026-01-05" });
    expect(tx.entries).toEqual([{ accountId: aliceAccount, amountCents: -4_250 }]);

    // L'autre utilisateur ne charge rien de tout cela.
    const other = await bob.batch(DATA_QUERIES);
    expect(other.data![1]).toEqual([]);
    expect(other.data![3]).toEqual([]);
  });

  it("traduit les erreurs des fonctions SQL en messages", async () => {
    const res = await alice.exec(sql`select public.delete_transaction(${"00000000-0000-0000-0000-000000000000"}::uuid)`);
    expect(dbErrorMessage(res.error)).toBe("Élément introuvable ou inaccessible.");
  });
});
