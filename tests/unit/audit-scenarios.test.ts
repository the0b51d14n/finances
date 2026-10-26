/**
 * Plan de tests prioritaires de l'audit fonctionnel : chaque bloc correspond à
 * une vérification critique ou élevée de la liste (règles de docs/REGLES-COMPTABLES.md).
 */
import { describe, expect, it } from "vitest";
import { balancesAt, totalsByClass } from "@/lib/domain/accounts";
import { includeEvent, projectDaily, type ForecastEvent } from "@/lib/domain/forecast";
import { goalAccumulated, overAllocatedAccounts } from "@/lib/domain/goals";
import { compareAmounts, summarizeMonth } from "@/lib/domain/monthly";
import { planPurchases, type PlanItem } from "@/lib/domain/planner";
import { occurrenceDates } from "@/lib/domain/recurrence";
import type { GoalAllocation, SavingsGoal } from "@/lib/domain/types";
import { account, byId, expense, income, rule, transfer, tx } from "./fixtures";

const TODAY = "2026-10-26";

describe("audit — critique", () => {
  it("les transferts ne modifient ni les revenus ni les dépenses du mois", () => {
    const chk = account("chk", "checking", 100_000, "2026-10-01");
    const liv = account("liv", "savings", 0, "2026-10-01");
    const m = summarizeMonth([transfer("2026-10-05", 30_000, "chk", "liv")], "2026-10", byId([chk, liv]), { today: TODAY });
    expect(m.incomeCents).toBe(0);
    expect(m.expenseCents).toBe(0);
    expect(m.netCents).toBe(0);
    expect(m.transfersCents).toBe(30_000);
    const totals = totalsByClass([chk, liv], balancesAt([chk, liv], [transfer("2026-10-05", 30_000, "chk", "liv")], TODAY));
    expect(totals.totalCents).toBe(100_000);
    expect(totals.availableCents).toBe(70_000);
  });

  it("le solde initial ne compte pas deux fois une opération antérieure (scénario de l'audit)", () => {
    const acc = account("acc", "checking", 50_000, "2026-10-01"); // 500 € au 1er octobre
    const txs = [expense("2026-10-03", 5_000, "acc"), expense("2026-09-20", 2_000, "acc")];
    expect(balancesAt([acc], txs, TODAY).get("acc")).toBe(45_000);
    // L'opération du 20 septembre reste dans l'historique et l'analyse de septembre.
    expect(summarizeMonth(txs, "2026-09", byId([acc]), { today: TODAY }).expenseCents).toBe(2_000);
  });

  it("la modification et la suppression d'une opération recalculent le solde (aucun total stocké)", () => {
    const acc = account("acc", "checking", 10_000, "2026-10-01");
    const original = expense("2026-10-03", 2_000, "acc");
    expect(balancesAt([acc], [original], TODAY).get("acc")).toBe(8_000);
    const edited = { ...original, amountCents: 3_500, entries: [{ accountId: "acc", amountCents: -3_500 }] };
    expect(balancesAt([acc], [edited], TODAY).get("acc")).toBe(6_500);
    expect(balancesAt([acc], [], TODAY).get("acc")).toBe(10_000);
  });

  it("les opérations prévues et annulées n'affectent ni le solde constaté ni le mois", () => {
    const acc = account("acc", "checking", 10_000, "2026-10-01");
    const txs = [
      expense("2026-10-04", 1_000, "acc", { status: "planned", confirmedAt: null }),
      income("2026-10-05", 5_000, "acc", { status: "cancelled", confirmedAt: null }),
    ];
    expect(balancesAt([acc], txs, TODAY).get("acc")).toBe(10_000);
    const m = summarizeMonth(txs, "2026-10", byId([acc]), { today: TODAY });
    expect(m.incomeCents + m.expenseCents).toBe(0);
  });

  it("les tickets-restaurant ne sont pas comptés deux fois dans les dépenses", () => {
    const chk = account("chk", "checking", 10_000, "2026-10-01");
    const tr = account("tr", "meal_voucher", 5_000, "2026-10-01");
    const split = tx("expense", "2026-10-06", 3_000, [["chk", -2_000], ["tr", -1_000]]);
    const m = summarizeMonth([split], "2026-10", byId([chk, tr]), { today: TODAY });
    expect(m.expenseCents).toBe(3_000);
    expect(m.voucherExpenseCents).toBe(1_000);
    const b = balancesAt([chk, tr], [split], TODAY);
    expect(b.get("chk")).toBe(8_000);
    expect(b.get("tr")).toBe(4_000);
    // Les tickets restent hors du total des soldes.
    expect(totalsByClass([chk, tr], b).totalCents).toBe(8_000);
  });
});

describe("audit — élevée", () => {
  it("les échéances mensuelles gèrent les 28, 29, 30 et 31 et les années bissextiles", () => {
    const r = rule({ kind: "expense", amountCents: 1_000, accountId: "chk", startDate: "2027-01-31" });
    expect(occurrenceDates(r, "2027-01-01", "2027-04-30")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    const leap = rule({ kind: "expense", amountCents: 1_000, accountId: "chk", startDate: "2028-01-30" });
    expect(occurrenceDates(leap, "2028-02-01", "2028-03-31")).toEqual(["2028-02-29", "2028-03-30"]);
    const d29 = rule({ kind: "expense", amountCents: 1_000, accountId: "chk", startDate: "2026-12-29" });
    expect(occurrenceDates(d29, "2027-02-01", "2027-03-31")).toEqual(["2027-02-28", "2027-03-29"]);
  });

  it("une variation mensuelle avec une référence nulle n'affiche pas de pourcentage trompeur", () => {
    expect(compareAmounts(5_000, 0)).toMatchObject({ pct: null, note: "new", diffCents: 5_000 });
    expect(compareAmounts(0, 0)).toMatchObject({ pct: null, note: "not_computable" });
    expect(compareAmounts(-1_000, -500)).toMatchObject({ pct: null, note: "not_computable" });
    expect(compareAmounts(15_000, 10_000)).toMatchObject({ pct: 50, note: null });
  });

  it("les objectifs d'épargne n'augmentent pas les soldes et les sur-affectations sont signalées", () => {
    const liv = account("liv", "savings", 50_000, "2026-10-01");
    const goal: SavingsGoal = {
      id: "g",
      name: "Dépôt de garantie",
      targetCents: 100_000,
      targetDate: null,
      monthlyContributionCents: null,
      priority: 1,
      tracking: "manual",
      accountId: "liv",
      achievedAt: null,
      archivedAt: null,
      notes: null,
    };
    const allocations: GoalAllocation[] = [{ id: "a", goalId: "g", date: "2026-10-02", amountCents: 60_000, note: null }];
    const balances = balancesAt([liv], [], TODAY);
    expect(totalsByClass([liv], balances).savingsCents).toBe(50_000);
    expect(goalAccumulated(goal, allocations, balances)).toBe(60_000);
    expect(overAllocatedAccounts([goal], allocations, balances)).toEqual([{ accountId: "liv", allocatedCents: 60_000, balanceCents: 50_000 }]);
  });

  it("le planificateur n'utilise jamais deux fois la même marge disponible", () => {
    const item = (id: string, order: number): PlanItem => ({
      id,
      name: id,
      priceCents: 80_000,
      priority: 2,
      notBefore: null,
      deadline: null,
      accountId: null,
      categoryId: null,
      order,
    });
    const r = planPurchases({
      today: TODAY,
      horizonEnd: "2027-10-26",
      availableNowCents: 100_000,
      events: [],
      reserveCents: 0,
      preserveBudgets: false,
      items: [item("a", 1), item("b", 2)],
    });
    expect(r.entries.find((e) => e.item.id === "a")?.status).toBe("scheduled");
    // Sans nouveau revenu, 1 000 € ne paient pas deux achats de 800 €.
    expect(r.entries.find((e) => e.item.id === "b")?.status).toBe("unschedulable");
  });

  it("les revenus probables et incertains ne gonflent pas le scénario garanti", () => {
    const ev = (certainty: ForecastEvent["certainty"], cents: number): ForecastEvent => ({
      date: "2026-10-30",
      originalDate: "2026-10-30",
      overdue: false,
      deltaCents: cents,
      grossCents: cents,
      label: `Revenu ${certainty}`,
      kind: "income",
      source: "recurring",
      certainty,
      categoryId: null,
      ruleId: null,
      transactionId: null,
      accountDeltas: [],
    });
    const events = [ev("certain", 100_000), ev("probable", 20_000), ev("uncertain", 50_000)];
    const guaranteed = projectDaily(0, events, TODAY, "2026-11-05", (e) => includeEvent(e, "guaranteed", false));
    const estimated = projectDaily(0, events, TODAY, "2026-11-05", (e) => includeEvent(e, "estimated", false));
    expect(guaranteed.at(-1)?.balanceCents).toBe(100_000);
    expect(estimated.at(-1)?.balanceCents).toBe(120_000);
  });
});
