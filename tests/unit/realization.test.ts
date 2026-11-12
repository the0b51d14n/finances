import { describe, expect, it } from "vitest";
import { dueRealizations } from "@/lib/domain/realization";
import { account, expense, rule, transfer } from "./fixtures";

const today = "2026-11-11";
const checking = account("courant", "checking");
const savings = account("livret", "savings");

describe("réalisation automatique (aucune confirmation)", () => {
  it("rend effective une opération prévue dont la date est atteinte, pas une opération future", () => {
    const past = expense("2026-11-05", 1_000, "courant", { status: "planned" });
    const todayTx = expense(today, 2_000, "courant", { status: "planned" });
    const future = expense("2026-11-20", 3_000, "courant", { status: "planned" });
    const due = dueRealizations({ today, accounts: [checking], transactions: [past, todayTx, future], rules: [] });
    expect(due).toEqual([
      { type: "confirm", transactionId: past.id },
      { type: "confirm", transactionId: todayTx.id },
    ]);
  });

  it("enregistre les échéances du jour et passées, au montant de la règle, avec leur date", () => {
    const loyer = rule({ kind: "expense", amountCents: 75_000, accountId: "courant", startDate: "2026-09-05", trackingStart: "2026-10-01", label: "Loyer" });
    const abonnement = rule({ kind: "expense", amountCents: 1_299, accountId: "courant", startDate: "2026-11-11", trackingStart: "2026-11-01" });
    const due = dueRealizations({ today, accounts: [checking], transactions: [], rules: [loyer, abonnement] });

    // Loyer : 05/10 et 05/11 (le 05/09 est avant le début de suivi). Abonnement du
    // 11/11 : jour férié (Armistice), reporté au 12/11, donc pas encore enregistré.
    expect(due.map((d) => (d.type === "occurrence" ? `${d.ruleId}@${d.date}` : d.type))).toEqual([
      `${loyer.id}@2026-10-05`,
      `${loyer.id}@2026-11-05`,
    ]);
    const nextDay = dueRealizations({ today: "2026-11-12", accounts: [checking], transactions: [], rules: [abonnement] });
    expect(nextDay.map((d) => d.type === "occurrence" && [d.date, d.payload.date])).toEqual([["2026-11-11", "2026-11-12"]]);
    const first = due[0];
    expect(first.type === "occurrence" && first.payload).toMatchObject({
      kind: "expense",
      status: "confirmed",
      date: "2026-10-05",
      label: "Loyer",
      amount_cents: 75_000,
      expected_amount_cents: 75_000,
      recurrence_id: loyer.id,
      occurrence_date: "2026-10-05",
      entries: [{ account_id: "courant", amount_cents: -75_000 }],
    });
  });

  it("n'enregistre jamais deux fois une échéance, ni une échéance ignorée", () => {
    const loyer = rule({ kind: "expense", amountCents: 75_000, accountId: "courant", startDate: "2026-10-05", trackingStart: "2026-10-01" });
    const done = expense("2026-10-06", 74_000, "courant", { recurrenceId: loyer.id, occurrenceDate: "2026-10-05" });
    const skipped = expense("2026-11-05", 75_000, "courant", { recurrenceId: loyer.id, occurrenceDate: "2026-11-05", status: "cancelled" });
    expect(dueRealizations({ today, accounts: [checking], transactions: [done, skipped], rules: [loyer] })).toEqual([]);
  });

  it("ignore les règles suspendues et celles dont un compte est archivé", () => {
    const paused = rule({ kind: "expense", amountCents: 500, accountId: "courant", startDate: "2026-11-01", isActive: false });
    const archived = account("ancien", "checking", 0, "2026-01-01", { archivedAt: "2026-06-01T00:00:00Z" });
    const onArchived = rule({ kind: "expense", amountCents: 500, accountId: "ancien", startDate: "2026-11-01" });
    expect(dueRealizations({ today, accounts: [checking, archived], transactions: [], rules: [paused, onArchived] })).toEqual([]);
  });

  it("enregistre les virements récurrents entre deux comptes", () => {
    const epargne = rule({ kind: "transfer", amountCents: 10_000, accountId: "courant", toAccountId: "livret", startDate: "2026-11-01", trackingStart: "2026-11-01" });
    const due = dueRealizations({ today, accounts: [checking, savings], transactions: [transfer("2026-10-01", 1, "courant", "livret")], rules: [epargne] });
    expect(due).toHaveLength(1);
    expect(due[0].type === "occurrence" && due[0].payload.entries).toEqual([
      { account_id: "courant", amount_cents: -10_000 },
      { account_id: "livret", amount_cents: 10_000 },
    ]);
  });
});
