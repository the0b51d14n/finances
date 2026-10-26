import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let alice: string;
let bob: string;

type Row = Record<string, unknown>;

async function createAccount(
  user: string,
  name: string,
  type: string,
  openingCents = 0,
  openingDate = "2026-01-01",
): Promise<string> {
  const [row] = await t.asUser<{ id: string }>(
    user,
    `insert into public.accounts (name, type, opening_balance_cents, opening_balance_date)
     values ($1, $2, $3, $4) returning id`,
    [name, type, openingCents, openingDate],
  );
  return row.id;
}

async function categoryId(user: string, key: string): Promise<string> {
  const [row] = await t.asUser<{ id: string }>(
    user,
    "select id from public.categories where system_key = $1",
    [key],
  );
  return row.id;
}

async function save(user: string, payload: Row): Promise<string> {
  const [row] = await t.asUser<{ id: string }>(
    user,
    "select public.save_transaction($1::jsonb) as id",
    [JSON.stringify(payload)],
  );
  return row.id;
}

async function balance(user: string, accountId: string): Promise<number> {
  const [row] = await t.asUser<{ balance_cents: number }>(
    user,
    "select balance_cents from public.account_balances where account_id = $1",
    [accountId],
  );
  return Number(row.balance_cents);
}

beforeAll(async () => {
  t = await createTestDb();
  alice = await t.createUser();
  bob = await t.createUser();
});

describe("initialisation utilisateur", () => {
  it("crée les paramètres et les catégories par défaut de façon idempotente", async () => {
    await t.asUser(alice, "select public.ensure_user_setup()");
    const cats = await t.asUser<{ n: number }>(alice, "select count(*)::int as n from public.categories");
    expect(cats[0].n).toBe(24);
    const settings = await t.asUser<Row>(alice, "select * from public.user_settings");
    expect(settings).toHaveLength(1);
    expect(settings[0].currency).toBe("EUR");
  });
});

describe("écritures comptables", () => {
  let checking: string;
  let livret: string;
  let vouchers: string;

  beforeAll(async () => {
    checking = await createAccount(alice, "Compte courant", "checking", 100_000);
    livret = await createAccount(alice, "Livret A", "savings", 50_000);
    vouchers = await createAccount(alice, "Tickets", "meal_voucher", 0);
  });

  it("un revenu augmente le solde", async () => {
    await save(alice, {
      kind: "income",
      date: "2026-02-01",
      label: "Salaire",
      amount_cents: 120_000,
      category_id: await categoryId(alice, "salary_apprentice"),
      entries: [{ account_id: checking, amount_cents: 120_000 }],
    });
    expect(await balance(alice, checking)).toBe(220_000);
  });

  it("une dépense diminue le solde", async () => {
    await save(alice, {
      kind: "expense",
      date: "2026-02-03",
      label: "Loyer",
      amount_cents: 45_000,
      category_id: await categoryId(alice, "housing"),
      entries: [{ account_id: checking, amount_cents: -45_000 }],
    });
    expect(await balance(alice, checking)).toBe(175_000);
  });

  it("un transfert déplace l'argent sans changer le total", async () => {
    const before = (await balance(alice, checking)) + (await balance(alice, livret));
    await save(alice, {
      kind: "transfer",
      date: "2026-02-05",
      label: "Épargne",
      amount_cents: 20_000,
      entries: [
        { account_id: checking, amount_cents: -20_000 },
        { account_id: livret, amount_cents: 20_000 },
      ],
    });
    expect(await balance(alice, checking)).toBe(155_000);
    expect(await balance(alice, livret)).toBe(70_000);
    const after = (await balance(alice, checking)) + (await balance(alice, livret));
    expect(after).toBe(before);
  });

  it("refuse des écritures déséquilibrées", async () => {
    await expect(
      save(alice, {
        kind: "transfer",
        date: "2026-02-05",
        label: "Transfert faux",
        amount_cents: 20_000,
        entries: [
          { account_id: checking, amount_cents: -20_000 },
          { account_id: livret, amount_cents: 15_000 },
        ],
      }),
    ).rejects.toThrow(/ledger_unbalanced/);

    await expect(
      save(alice, {
        kind: "expense",
        date: "2026-02-05",
        label: "Dépense positive",
        amount_cents: 1_000,
        category_id: await categoryId(alice, "leisure"),
        entries: [{ account_id: checking, amount_cents: 1_000 }],
      }),
    ).rejects.toThrow(/ledger_unbalanced/);
    // Rien n'a été partiellement écrit.
    expect(await balance(alice, checking)).toBe(155_000);
  });

  it("refuse une catégorie incohérente avec le type de mouvement", async () => {
    await expect(
      save(alice, {
        kind: "expense",
        date: "2026-02-05",
        label: "Mauvaise catégorie",
        amount_cents: 1_000,
        category_id: await categoryId(alice, "salary_apprentice"),
        entries: [{ account_id: checking, amount_cents: -1_000 }],
      }),
    ).rejects.toThrow(/foreign key/);
  });

  it("une dépense payée en partie en tickets-restaurant ne débite la banque que de sa part", async () => {
    await save(alice, {
      kind: "income",
      date: "2026-02-01",
      label: "Crédit tickets",
      amount_cents: 15_000,
      category_id: await categoryId(alice, "meal_voucher_credit"),
      entries: [{ account_id: vouchers, amount_cents: 15_000 }],
    });
    await save(alice, {
      kind: "expense",
      date: "2026-02-06",
      label: "Supermarché",
      amount_cents: 3_000,
      category_id: await categoryId(alice, "groceries"),
      entries: [
        { account_id: checking, amount_cents: -2_000 },
        { account_id: vouchers, amount_cents: -1_000 },
      ],
    });
    expect(await balance(alice, checking)).toBe(153_000);
    expect(await balance(alice, vouchers)).toBe(14_000);
  });

  it("interdit les transferts depuis ou vers un portefeuille de tickets", async () => {
    await expect(
      save(alice, {
        kind: "transfer",
        date: "2026-02-06",
        label: "Tickets vers banque",
        amount_cents: 1_000,
        entries: [
          { account_id: vouchers, amount_cents: -1_000 },
          { account_id: checking, amount_cents: 1_000 },
        ],
      }),
    ).rejects.toThrow(/meal_voucher_transfer/);
  });

  it("une opération prévue n'affecte pas le solde avant confirmation", async () => {
    const id = await save(alice, {
      kind: "expense",
      status: "planned",
      date: "2026-02-10",
      label: "Assurance",
      amount_cents: 5_000,
      category_id: await categoryId(alice, "insurance"),
      entries: [{ account_id: checking, amount_cents: -5_000 }],
    });
    expect(await balance(alice, checking)).toBe(153_000);
    await t.asUser(alice, "select public.set_transaction_status($1, 'confirmed', null)", [id]);
    expect(await balance(alice, checking)).toBe(148_000);
    await t.asUser(alice, "select public.set_transaction_status($1, 'cancelled', null)", [id]);
    expect(await balance(alice, checking)).toBe(148_000 + 5_000);
  });

  it("refuse une opération confirmée datée dans le futur", async () => {
    await expect(
      save(alice, {
        kind: "expense",
        date: "2099-01-01",
        label: "Futur",
        amount_cents: 100,
        category_id: await categoryId(alice, "leisure"),
        entries: [{ account_id: checking, amount_cents: -100 }],
      }),
    ).rejects.toThrow(/confirmed_in_future/);
  });

  it("ignore dans le solde les opérations antérieures au solde initial", async () => {
    const acc = await createAccount(alice, "Compte récent", "checking", 10_000, "2026-03-01");
    await save(alice, {
      kind: "expense",
      date: "2026-02-15",
      label: "Avant ouverture",
      amount_cents: 2_500,
      category_id: await categoryId(alice, "leisure"),
      entries: [{ account_id: acc, amount_cents: -2_500 }],
    });
    await save(alice, {
      kind: "expense",
      date: "2026-03-01",
      label: "Jour de référence",
      amount_cents: 1_000,
      category_id: await categoryId(alice, "leisure"),
      entries: [{ account_id: acc, amount_cents: -1_000 }],
    });
    expect(await balance(alice, acc)).toBe(9_000);
    const [row] = await t.asUser<{ n: number }>(
      alice,
      "select entries_before_opening::int as n from public.account_balances where account_id = $1",
      [acc],
    );
    expect(row.n).toBe(1);
  });

  it("est idempotent face à une double soumission", async () => {
    const req = "11111111-2222-4333-8444-555555555555";
    const payload = {
      kind: "expense",
      date: "2026-02-11",
      label: "Café",
      amount_cents: 250,
      client_request_id: req,
      category_id: await categoryId(alice, "leisure"),
      entries: [{ account_id: checking, amount_cents: -250 }],
    };
    const before = await balance(alice, checking);
    const id1 = await save(alice, payload);
    const id2 = await save(alice, payload);
    expect(id2).toBe(id1);
    expect(await balance(alice, checking)).toBe(before - 250);
  });

  it("modifie une opération en recalculant le solde et en conservant une trace", async () => {
    const leisure = await categoryId(alice, "leisure");
    const id = await save(alice, {
      kind: "expense",
      date: "2026-02-12",
      label: "Cinéma",
      amount_cents: 1_200,
      category_id: leisure,
      entries: [{ account_id: checking, amount_cents: -1_200 }],
    });
    const before = await balance(alice, checking);
    await save(alice, {
      id,
      kind: "expense",
      date: "2026-02-12",
      label: "Cinéma + pop-corn",
      amount_cents: 1_800,
      category_id: leisure,
      entries: [{ account_id: checking, amount_cents: -1_800 }],
    });
    expect(await balance(alice, checking)).toBe(before - 600);
    const audit = await t.asUser<{ old_data: Row }>(
      alice,
      "select old_data from public.transaction_audit where transaction_id = $1",
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].old_data.label).toBe("Cinéma");
    expect(audit[0].old_data.amount_cents).toBe(1_200);

    await t.asUser(alice, "select public.delete_transaction($1)", [id]);
    expect(await balance(alice, checking)).toBe(before + 1_200);
    const entries = await t.asUser(alice, "select * from public.entries where transaction_id = $1", [id]);
    expect(entries).toHaveLength(0);
    const audit2 = await t.asUser(alice, "select * from public.transaction_audit where transaction_id = $1", [id]);
    expect(audit2).toHaveLength(2);
  });

  it("n'accepte plus de nouvelles écritures sur un compte archivé", async () => {
    const acc = await createAccount(alice, "Ancien compte", "checking", 0);
    await t.asUser(alice, "update public.accounts set archived_at = now() where id = $1", [acc]);
    await expect(
      save(alice, {
        kind: "expense",
        date: "2026-02-12",
        label: "Test",
        amount_cents: 100,
        category_id: await categoryId(alice, "leisure"),
        entries: [{ account_id: acc, amount_cents: -100 }],
      }),
    ).rejects.toThrow(/account_archived/);
  });
});

describe("récurrences", () => {
  it("empêche de réaliser deux fois la même occurrence et conserve l'historique à la suppression", async () => {
    const acc = await createAccount(alice, "Compte récurrences", "checking", 100_000);
    const housing = await categoryId(alice, "housing");
    const [rule] = await t.asUser<{ id: string }>(
      alice,
      `insert into public.recurring_rules (kind, label, amount_cents, account_id, category_id, frequency, start_date)
       values ('expense', 'Loyer', 45000, $1, $2, 'monthly', '2026-01-05') returning id`,
      [acc, housing],
    );
    const occurrence = {
      kind: "expense",
      date: "2026-02-05",
      label: "Loyer",
      amount_cents: 45_000,
      category_id: housing,
      recurrence_id: rule.id,
      occurrence_date: "2026-02-05",
      entries: [{ account_id: acc, amount_cents: -45_000 }],
    };
    const txId = await save(alice, occurrence);
    await expect(save(alice, occurrence)).rejects.toThrow(/recurrence_id_occurrence_date/);

    await t.asUser(alice, "select public.delete_recurring_rule($1)", [rule.id]);
    const [tx] = await t.asUser<Row>(alice, "select * from public.transactions where id = $1", [txId]);
    expect(tx.recurrence_id).toBeNull();
    expect(tx.amount_cents).toBe(45_000);
  });
});

describe("banques et planification d'achats", () => {
  it("enregistre la banque, le compte de dépenses et les achats planifiés sans référence croisée", async () => {
    const [bourso] = await t.asUser<{ id: string }>(
      alice,
      `insert into public.accounts (name, type, institution, opening_balance_cents, opening_balance_date)
       values ('Compte Boursorama', 'checking', 'Boursorama', 10000, '2026-10-01') returning id`,
    );
    await t.asUser(alice, "update public.user_settings set spending_account_id = $1", [bourso.id]);
    const furniture = await categoryId(alice, "home_furnishing");
    await t.asUser(
      alice,
      `insert into public.purchase_plans (name, price_cents, priority, project, deadline, account_id, category_id)
       values ('Lit', 25000, 1, 'Emménagement', '2026-12-01', $1, $2)`,
      [bourso.id, furniture],
    );
    const [plan] = await t.asUser<Row>(alice, "select project, deadline from public.purchase_plans where name = 'Lit'");
    expect(plan.project).toBe("Emménagement");

    // Bob ne peut pas rattacher un achat ni son compte de dépenses au compte d'Alice.
    await expect(
      t.asUser(bob, "insert into public.purchase_plans (name, price_cents, account_id) values ('X', 100, $1)", [bourso.id]),
    ).rejects.toThrow(/foreign key/);
    await expect(t.asUser(bob, "update public.user_settings set spending_account_id = $1", [bourso.id])).rejects.toThrow(
      /foreign key/,
    );
  });

  it("refuse une date limite antérieure à la date « pas avant »", async () => {
    await expect(
      t.asUser(alice, "insert into public.purchase_plans (name, price_cents, desired_date, deadline) values ('Table', 100, '2026-12-10', '2026-12-01')"),
    ).rejects.toThrow(/purchase_plans_deadline_check/);
  });
});

describe("contrôle des accès", () => {
  let aliceAccount: string;
  let aliceTx: string;

  beforeAll(async () => {
    aliceAccount = await createAccount(alice, "Compte privé", "checking", 5_000);
    aliceTx = await save(alice, {
      kind: "expense",
      date: "2026-02-01",
      label: "Privé",
      amount_cents: 100,
      category_id: await categoryId(alice, "leisure"),
      entries: [{ account_id: aliceAccount, amount_cents: -100 }],
    });
  });

  it("un utilisateur ne voit pas les données d'un autre", async () => {
    const accounts = await t.asUser(bob, "select * from public.accounts where id = $1", [aliceAccount]);
    expect(accounts).toHaveLength(0);
    const txs = await t.asUser(bob, "select * from public.transactions where id = $1", [aliceTx]);
    expect(txs).toHaveLength(0);
    const balances = await t.asUser(bob, "select * from public.account_balances where account_id = $1", [aliceAccount]);
    expect(balances).toHaveLength(0);
  });

  it("un utilisateur ne peut pas écrire sur le compte d'un autre", async () => {
    await expect(
      save(bob, {
        kind: "expense",
        date: "2026-02-01",
        label: "Intrusion",
        amount_cents: 100,
        category_id: await categoryId(bob, "leisure"),
        entries: [{ account_id: aliceAccount, amount_cents: -100 }],
      }),
    ).rejects.toThrow(/foreign key/);
    await expect(
      save(bob, {
        id: aliceTx,
        kind: "expense",
        date: "2026-02-01",
        label: "Intrusion",
        amount_cents: 100,
        category_id: await categoryId(bob, "leisure"),
        entries: [{ account_id: aliceAccount, amount_cents: -100 }],
      }),
    ).rejects.toThrow(/transaction_not_found/);
    await expect(t.asUser(bob, "select public.delete_transaction($1)", [aliceTx])).rejects.toThrow(
      /transaction_not_found/,
    );
    const updated = await t.asUser(bob, "update public.accounts set name = 'pirate' where id = $1 returning id", [
      aliceAccount,
    ]);
    expect(updated).toHaveLength(0);
  });

  it("interdit l'écriture directe dans les tables comptables", async () => {
    await expect(
      t.asUser(alice, "insert into public.entries (user_id, transaction_id, account_id, amount_cents) values ($1, $2, $3, 1)", [
        alice,
        aliceTx,
        aliceAccount,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(t.asUser(alice, "update public.transactions set amount_cents = 1 where id = $1", [aliceTx])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("refuse les appels non authentifiés", async () => {
    await t.db.exec("set role anon");
    try {
      await expect(t.db.query("select * from public.accounts")).rejects.toThrow(/permission denied/);
      await expect(t.db.query("select public.ensure_user_setup()")).rejects.toThrow(/permission denied/);
    } finally {
      await t.db.exec("reset role");
    }
  });

  it("supprime toutes les données de l'utilisateur sur demande explicite", async () => {
    const carol = await t.createUser();
    const acc = await createAccount(carol, "Compte", "checking", 1_000);
    await save(carol, {
      kind: "expense",
      date: "2026-02-01",
      label: "Test",
      amount_cents: 100,
      category_id: await categoryId(carol, "leisure"),
      entries: [{ account_id: acc, amount_cents: -100 }],
    });
    await expect(t.asUser(carol, "select public.delete_all_my_data('non')")).rejects.toThrow(/confirmation_required/);
    await t.asUser(carol, "select public.delete_all_my_data('SUPPRIMER')");
    const remaining = await t.admin<{ n: number }>(
      `select (select count(*) from public.accounts where user_id = $1)
            + (select count(*) from public.transactions where user_id = $1)
            + (select count(*) from public.categories where user_id = $1) as n`,
      [carol],
    );
    expect(Number(remaining[0].n)).toBe(0);
    // Les données d'Alice sont intactes.
    const aliceAccounts = await t.asUser(alice, "select id from public.accounts");
    expect(aliceAccounts.length).toBeGreaterThan(0);
  });
});
