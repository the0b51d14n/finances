import { describe, expect, it } from "vitest";
import { computeDashboard } from "@/lib/domain/dashboard";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { account, income, rule } from "./fixtures";

const TODAY = "2026-11-13";
const secondaire = account("secondaire", "checking", 50_000);
const auchan = rule({ kind: "income", amountCents: 90_000, accountId: "secondaire", startDate: "2026-11-10", label: "Salaire Auchan", variableAmount: true });
const alternance = rule({ kind: "income", amountCents: 110_000, accountId: "secondaire", startDate: "2026-11-05", label: "Salaire alternance" });

const reminders = (transactions: ReturnType<typeof income>[]) =>
  computeDashboard({
    today: TODAY,
    accounts: [secondaire],
    transactions,
    rules: [auchan, alternance],
    budgets: [],
    goals: [],
    allocations: [],
    settings: DEFAULT_SETTINGS,
    categoryName: (id) => id,
  }).alerts.filter((a) => a.title.endsWith("confirmer le montant reçu"));

describe("échéance à montant variable : demande de confirmer le montant reçu", () => {
  const paieAuchan = income("2026-11-10", 90_000, "secondaire", { label: "Salaire Auchan", recurrenceId: auchan.id, occurrenceDate: "2026-11-10" });
  const paieAlternance = income("2026-11-05", 110_000, "secondaire", { label: "Salaire alternance", recurrenceId: alternance.id, occurrenceDate: "2026-11-05" });

  it("rappelle de saisir le montant d'un salaire variable enregistré automatiquement", () => {
    const r = reminders([paieAuchan, paieAlternance]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ level: "info", title: "Salaire Auchan : confirmer le montant reçu", href: `/operations/${paieAuchan.id}` });
  });

  it("ne demande plus rien une fois le montant confirmé ou modifié", () => {
    expect(reminders([{ ...paieAuchan, amountCents: 104_350, updatedAt: "2026-11-12T18:00:00Z" }])).toEqual([]);
  });
});
