import { describe, expect, it } from "vitest";
import { depletedSingleUseAccounts } from "@/lib/domain/accounts";
import { accountChoices } from "@/lib/domain/dashboard";
import { paysViaTransfer, planPayment, transferHops } from "@/lib/domain/ledger";
import { expenseSchema } from "@/lib/validation/schemas";
import { account, byId, expense } from "./fixtures";

const principal = account("principal", "checking", 3_000, "2026-01-01", { subtype: "current" });
const secondaire = account("secondaire", "checking", 50_000, "2026-01-01", { subtype: "secondary" });
const livretA = account("livretA", "savings", 300_000, "2026-01-01", { subtype: "livret_a" });
const bzb = account("bzb", "earmarked", 2_000, "2026-01-01", { subtype: "gift_card" });
const especes = account("especes", "cash", 1_500, "2026-01-01", { subtype: "cash" });
const accounts = byId([principal, secondaire, livretA, bzb, especes]);

describe("dépense payée par plusieurs comptes", () => {
  it("répartit la dépense : chaque moyen paie sa part, le compte qui paie règle le reste", () => {
    const plan = planPayment(
      {
        amountCents: 6_000,
        accountId: "principal",
        payments: [
          { accountId: "bzb", amountCents: 2_000 },
          { accountId: "especes", amountCents: 1_000 },
        ],
      },
      accounts,
    );
    expect(plan).toEqual({
      ok: true,
      transfers: [],
      entries: [
        { accountId: "principal", amountCents: -3_000 },
        { accountId: "bzb", amountCents: -2_000 },
        { accountId: "especes", amountCents: -1_000 },
      ],
    });
  });

  it("fait passer la part d'un livret par le compte secondaire jusqu'au compte qui paie (chemin de l'argent)", () => {
    const plan = planPayment({ amountCents: 10_000, accountId: "principal", payments: [{ accountId: "livretA", amountCents: 7_000 }] }, accounts);
    expect(plan).toEqual({
      ok: true,
      transfers: [
        { fromAccountId: "livretA", toAccountId: "secondaire", amountCents: 7_000 },
        { fromAccountId: "secondaire", toAccountId: "principal", amountCents: 7_000 },
      ],
      // Le compte qui paie règle tout : sa part + ce que le livret vient de lui faire parvenir.
      entries: [{ accountId: "principal", amountCents: -10_000 }],
    });
  });

  it("chemin d'un virement : livret → secondaire → principal, dans les deux sens", () => {
    expect(transferHops("livretA", "principal", accounts)).toEqual([
      { fromAccountId: "livretA", toAccountId: "secondaire" },
      { fromAccountId: "secondaire", toAccountId: "principal" },
    ]);
    expect(transferHops("principal", "livretA", accounts)).toEqual([
      { fromAccountId: "principal", toAccountId: "secondaire" },
      { fromAccountId: "secondaire", toAccountId: "livretA" },
    ]);
    // Déjà depuis ou vers le secondaire, ou sans livret : une seule étape.
    expect(transferHops("livretA", "secondaire", accounts)).toEqual([{ fromAccountId: "livretA", toAccountId: "secondaire" }]);
    expect(transferHops("principal", "secondaire", accounts)).toEqual([{ fromAccountId: "principal", toAccountId: "secondaire" }]);
    // Sans compte secondaire : virement direct.
    expect(transferHops("livretA", "principal", byId([principal, livretA]))).toEqual([{ fromAccountId: "livretA", toAccountId: "principal" }]);
  });

  it("combine carte cadeau, livret et compte qui paie", () => {
    const plan = planPayment(
      {
        amountCents: 12_000,
        accountId: "secondaire",
        payments: [
          { accountId: "bzb", amountCents: 2_000 },
          { accountId: "livretA", amountCents: 5_000 },
        ],
      },
      accounts,
    );
    expect(plan.ok && plan.transfers).toEqual([{ fromAccountId: "livretA", toAccountId: "secondaire", amountCents: 5_000 }]);
    expect(plan.ok && plan.entries).toEqual([
      { accountId: "secondaire", amountCents: -10_000 },
      { accountId: "bzb", amountCents: -2_000 },
    ]);
  });

  it("refuse les saisies incohérentes", () => {
    // Un livret ne paie jamais directement.
    expect(planPayment({ amountCents: 1_000, accountId: "livretA", payments: [] }, accounts).ok).toBe(false);
    // Une carte cadeau ne reçoit pas de virement : elle ne peut pas être le compte qui paie avec un livret.
    expect(planPayment({ amountCents: 1_000, accountId: "bzb", payments: [{ accountId: "livretA", amountCents: 500 }] }, accounts).ok).toBe(false);
    // Dépassement, doublon, compte qui paie répété.
    expect(planPayment({ amountCents: 1_000, accountId: "principal", payments: [{ accountId: "bzb", amountCents: 2_000 }] }, accounts).ok).toBe(false);
    expect(
      planPayment(
        {
          amountCents: 5_000,
          accountId: "principal",
          payments: [
            { accountId: "bzb", amountCents: 100 },
            { accountId: "bzb", amountCents: 100 },
          ],
        },
        accounts,
      ).ok,
    ).toBe(false);
    expect(planPayment({ amountCents: 5_000, accountId: "principal", payments: [{ accountId: "principal", amountCents: 100 }] }, accounts).ok).toBe(false);
  });

  it("ne fait passer par un virement que l'épargne et les placements", () => {
    expect(paysViaTransfer("savings")).toBe(true);
    expect(paysViaTransfer("dedicated_savings")).toBe(true);
    expect(paysViaTransfer("investment")).toBe(true);
    expect(paysViaTransfer("checking")).toBe(false);
    expect(paysViaTransfer("earmarked")).toBe(false);
    expect(paysViaTransfer("cash")).toBe(false);
  });

  it("retire la carte cadeau dès qu'elle tombe à zéro", () => {
    expect(depletedSingleUseAccounts([bzb], [expense("2026-11-13", 2_000, "bzb")], "2026-11-13")).toEqual(["bzb"]);
    expect(depletedSingleUseAccounts([bzb], [expense("2026-11-13", 1_500, "bzb")], "2026-11-13")).toEqual([]);
  });
});

describe("listes de comptes", () => {
  it("affiche nom, nature et solde, regroupés par banque, sans répéter la nature égale au nom", () => {
    const bon = account("bon", "earmarked", 1_500, "2026-01-01", { subtype: "store_credit", name: "BZB", institution: "BZB" });
    const carte = { ...bzb, name: "BZB", institution: "BZB" };
    const livret = { ...livretA, name: "Livret A", institution: "Caisse d'épargne" };
    const choices = accountChoices({ accounts: [livret, carte, bon, especes], transactions: [], today: "2026-11-14" });
    expect(choices.map((c) => [c.group, c.label.replace(/\s/g, " "), c.viaTransfer])).toEqual([
      ["BZB", "BZB · Carte cadeau · 20,00 €", false],
      ["BZB", "BZB · Avoirs et bons d'achat · 15,00 €", false],
      ["Caisse d'épargne", "Livret A · 3 000,00 €", true],
      ["Sans banque", "especes · Espèces · 15,00 €", false],
    ]);
  });
});

describe("saisie des autres moyens de paiement", () => {
  const base = {
    amount: "60,00",
    category_id: "11111111-1111-4111-8111-111111111111",
    account_id: "22222222-2222-4222-8222-222222222222",
    date: "2026-11-13",
  };
  const other = "33333333-3333-4333-8333-333333333333";

  it("lit la liste JSON et la valide", () => {
    expect(expenseSchema.parse({ ...base, payments: JSON.stringify([{ account_id: other, amount_cents: 2_000 }]) }).payments).toEqual([
      { account_id: other, amount_cents: 2_000 },
    ]);
    expect(expenseSchema.parse({ ...base, payments: "" }).payments).toEqual([]);
    expect(expenseSchema.safeParse({ ...base, payments: JSON.stringify([{ account_id: other, amount_cents: 7_000 }]) }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, payments: JSON.stringify([{ account_id: base.account_id, amount_cents: 100 }]) }).success).toBe(false);
    expect(
      expenseSchema.safeParse({ ...base, repeat: "monthly", day: "5", payments: JSON.stringify([{ account_id: other, amount_cents: 100 }]) }).success,
    ).toBe(false);
  });
});
