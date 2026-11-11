import { describe, expect, it } from "vitest";
import type { ForecastEvent } from "@/lib/domain/forecast";
import { proposeMoneyPath } from "@/lib/domain/money-path";
import { account, rule } from "./fixtures";

const today = "2026-11-11";
// Organisation : salaires et prélèvements sur le courant secondaire, dépenses
// courantes sur le courant principal, épargne sur un livret.
const secondaire = account("secondaire", "checking", 0, "2026-01-01", { institution: "Caisse d'Épargne" });
const livretA = account("livretA", "savings", 0, "2026-01-01", { institution: "Caisse d'Épargne" });
const principal = account("principal", "checking", 0, "2026-01-01", { institution: "Boursorama" });
const salaire = rule({ kind: "income", amountCents: 200_000, accountId: "secondaire", startDate: "2026-01-28" });

const balances = (entries: [string, number][]) => new Map(entries);
const base = {
  today,
  accounts: [secondaire, livretA, principal],
  events: [] as ForecastEvent[],
  rules: [salaire],
  withBudgets: false,
  payerAccountId: "principal",
  date: "2026-12-05",
};

/** Prélèvement certain sur un compte (forme minimale d'un événement de prévision). */
function bill(accountId: string, date: string, cents: number): ForecastEvent {
  return {
    date,
    originalDate: date,
    overdue: false,
    deltaCents: -cents,
    grossCents: cents,
    label: "Prélèvement",
    kind: "expense",
    source: "recurring",
    certainty: "certain",
    categoryId: null,
    ruleId: "r",
    transactionId: null,
    accountDeltas: [{ accountId, amountCents: -cents }],
  };
}

describe("chemin de l'argent pour une dépense ponctuelle", () => {
  it("ne propose rien quand le courant principal suffit", () => {
    const p = proposeMoneyPath({ ...base, amountCents: 10_000, balances: balances([["secondaire", 0], ["livretA", 500_000], ["principal", 15_000]]) });
    expect(p).toEqual({ steps: [], shortfallCents: 0, uncoveredCents: 0 });
  });

  it("secondaire suffisant : un seul virement secondaire → principal, l'épargne n'est pas touchée", () => {
    const p = proposeMoneyPath({ ...base, amountCents: 80_000, balances: balances([["secondaire", 300_000], ["livretA", 500_000], ["principal", 15_000]]) });
    expect(p.shortfallCents).toBe(65_000);
    expect(p.steps).toEqual([{ fromAccountId: "secondaire", toAccountId: "principal", amountCents: 65_000, date: "2026-12-04" }]);
  });

  it("secondaire insuffisant (ses prélèvements restent couverts) : épargne → secondaire → principal", () => {
    const p = proposeMoneyPath({
      ...base,
      events: [bill("secondaire", "2026-12-10", 75_000)], // loyer
      amountCents: 80_000,
      balances: balances([["secondaire", 95_000], ["livretA", 500_000], ["principal", 15_000]]),
    });
    // Le secondaire peut donner 200 € (il garde 750 € pour le loyer) ; l'épargne fournit 450 €.
    expect(p.uncoveredCents).toBe(0);
    expect(p.steps).toEqual([
      { fromAccountId: "livretA", toAccountId: "secondaire", amountCents: 45_000, date: "2026-12-03" },
      { fromAccountId: "secondaire", toAccountId: "principal", amountCents: 65_000, date: "2026-12-04" },
    ]);
  });

  it("le secondaire est le compte qui reçoit les salaires", () => {
    const autre = account("autre", "checking", 0, "2026-01-01", { institution: "Caisse d'Épargne" });
    const p = proposeMoneyPath({
      ...base,
      accounts: [autre, secondaire, livretA, principal],
      amountCents: 20_000,
      balances: balances([["autre", 900_000], ["secondaire", 0], ["livretA", 100_000], ["principal", 0]]),
    });
    expect(p.steps.map((s) => `${s.fromAccountId}→${s.toAccountId}`)).toEqual(["livretA→secondaire", "secondaire→principal"]);
  });

  it("vire directement depuis l'épargne sans autre compte courant", () => {
    const p = proposeMoneyPath({ ...base, accounts: [livretA, principal], amountCents: 50_000, balances: balances([["livretA", 100_000], ["principal", 0]]) });
    expect(p.steps).toEqual([{ fromAccountId: "livretA", toAccountId: "principal", amountCents: 50_000, date: "2026-12-04" }]);
  });

  it("signale la part qu'aucune source ne couvre", () => {
    const p = proposeMoneyPath({ ...base, amountCents: 80_000, balances: balances([["secondaire", 10_000], ["livretA", 20_000], ["principal", 0]]) });
    expect(p.shortfallCents).toBe(80_000);
    expect(p.uncoveredCents).toBe(50_000);
    expect(p.steps.at(-1)).toMatchObject({ fromAccountId: "secondaire", toAccountId: "principal", amountCents: 30_000 });
  });

  it("ne date jamais un virement avant aujourd'hui", () => {
    const p = proposeMoneyPath({ ...base, date: today, amountCents: 5_000, balances: balances([["secondaire", 0], ["livretA", 50_000], ["principal", 0]]) });
    expect(p.steps.map((s) => s.date)).toEqual([today, today]);
  });
});
