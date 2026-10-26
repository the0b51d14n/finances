import { describe, expect, it } from "vitest";
import { buildForecastEvents, includeEvent, minBalance, nextIncome, projectDaily } from "@/lib/domain/forecast";
import { simulatePurchase, type SimulationInput } from "@/lib/domain/simulator";
import type { Budget, RecurringRule, Transaction } from "@/lib/domain/types";
import { account, budget, expense, income, rule, tx } from "./fixtures";

const TODAY = "2026-10-25"; // dimanche
const HORIZON = "2027-12-31";

const chk = account("chk", "checking", 50_000, "2026-10-01");
const liv = account("liv", "savings", 100_000, "2026-10-01");
const tr = account("tr", "meal_voucher", 10_000, "2026-10-01");
const accounts = [chk, liv, tr];

const salary = rule({ kind: "income", label: "Salaire", amountCents: 150_000, accountId: "chk", startDate: "2026-01-28", trackingStart: TODAY });
const rent = rule({ kind: "expense", label: "Loyer", amountCents: 60_000, accountId: "chk", startDate: "2026-01-05", trackingStart: TODAY });

function events(rules: RecurringRule[], transactions: Transaction[] = [], budgets: Budget[] = []) {
  return buildForecastEvents({ today: TODAY, horizonEnd: HORIZON, accounts, rules, transactions, budgets });
}

function guaranteed(rules: RecurringRule[], start = 50_000, transactions: Transaction[] = []) {
  return projectDaily(start, events(rules, transactions), TODAY, HORIZON, (e) => includeEvent(e, "guaranteed", false));
}

describe("moteur de prévision", () => {
  it("respecte l'ordre chronologique des entrées et sorties", () => {
    // Loyer le 27, salaire le 28 : une simple soustraction (500 + 1500 − 600) masquerait le découvert du 27.
    const earlyRent = rule({ kind: "expense", amountCents: 60_000, accountId: "chk", startDate: "2026-10-27", trackingStart: TODAY });
    const points = guaranteed([salary, earlyRent]);
    expect(points.find((p) => p.date === "2026-10-27")!.balanceCents).toBe(-10_000);
    expect(points.find((p) => p.date === "2026-10-28")!.balanceCents).toBe(140_000);
    expect(minBalance(points, TODAY, "2026-11-30")).toEqual({ date: "2026-10-27", balanceCents: -10_000 });
  });

  it("projette le solde jour par jour à partir des échéances", () => {
    const points = guaranteed([salary, rent]);
    const at = (d: string) => points.find((p) => p.date === d)!.balanceCents;
    expect(at(TODAY)).toBe(50_000);
    expect(at("2026-10-28")).toBe(200_000);
    expect(at("2026-11-05")).toBe(140_000);
    expect(at("2026-11-28")).toBe(290_000);
    expect(nextIncome(events([salary, rent]), "guaranteed", TODAY)?.date).toBe("2026-10-28");
  });

  it("ne retient que l'effet sur l'argent disponible", () => {
    const toSavings = rule({ kind: "transfer", amountCents: 20_000, accountId: "chk", toAccountId: "liv", startDate: "2026-11-01", trackingStart: TODAY });
    const fromSavings = rule({ kind: "transfer", amountCents: 5_000, accountId: "liv", toAccountId: "chk", startDate: "2026-11-02", trackingStart: TODAY });
    const fromLivret = rule({ kind: "expense", amountCents: 9_999, accountId: "liv", startDate: "2026-11-03", trackingStart: TODAY });
    const voucherMeal = tx("expense", "2026-11-04", 1_000, [["tr", -1_000]], { status: "planned", confirmedAt: null });
    const evts = events([toSavings, fromSavings, fromLivret], [voucherMeal]).filter((e) => e.date <= "2026-11-30");
    expect(evts.map((e) => [e.date, e.deltaCents])).toEqual([
      ["2026-11-01", -20_000],
      ["2026-11-02", 5_000],
    ]);
  });

  it("reporte à aujourd'hui une échéance passée non confirmée", () => {
    const late = rule({ kind: "expense", amountCents: 3_000, accountId: "chk", startDate: "2026-10-20", trackingStart: "2026-10-01", frequency: "annual" });
    const [e] = events([late]);
    expect(e).toMatchObject({ date: TODAY, originalDate: "2026-10-20", overdue: true, deltaCents: -3_000 });
  });

  it("n'utilise une opération prévue qu'une fois et ignore les échéances déjà réalisées", () => {
    const planned = income("2026-10-28", 150_000, "chk", { recurrenceId: salary.id, occurrenceDate: "2026-10-28", status: "planned", confirmedAt: null });
    const evts = events([salary], [planned]).filter((e) => e.date === "2026-10-28");
    expect(evts).toHaveLength(1);
    expect(evts[0].source).toBe("planned");
  });

  it("préserve les enveloppes budgétaires sans recompter les dépenses déjà programmées", () => {
    const groceriesRule = rule({ kind: "expense", amountCents: 6_000, accountId: "chk", startDate: "2026-10-27", frequency: "weekly", categoryId: "food", trackingStart: TODAY });
    const spentThisWeek = expense("2026-10-21", 3_000, "chk", { categoryId: "food" });
    const evts = events([groceriesRule], [spentThisWeek], [budget("food", "weekly", 8_000), budget("food", "monthly", 99_999)]);
    const envelopes = evts.filter((e) => e.source === "budget");
    expect(envelopes[0]).toMatchObject({ date: TODAY, deltaCents: -5_000 });
    expect(envelopes[1]).toMatchObject({ date: "2026-10-26", deltaCents: -2_000 });
    // Le budget mensuel de la même catégorie n'est pas ajouté par-dessus l'hebdomadaire.
    expect(envelopes.every((e) => e.grossCents <= 8_000)).toBe(true);
  });

  it("distingue revenus certains, probables et incertains", () => {
    const probable = rule({ kind: "income", amountCents: 10_000, accountId: "chk", startDate: "2026-11-10", certainty: "probable", trackingStart: TODAY });
    const uncertain = rule({ kind: "income", amountCents: 20_000, accountId: "chk", startDate: "2026-11-10", certainty: "uncertain", trackingStart: TODAY });
    const evts = events([probable, uncertain]);
    const end = "2026-11-15";
    const g = projectDaily(0, evts, TODAY, end, (e) => includeEvent(e, "guaranteed", false));
    const est = projectDaily(0, evts, TODAY, end, (e) => includeEvent(e, "estimated", false));
    expect(g.at(-1)!.balanceCents).toBe(0);
    expect(est.at(-1)!.balanceCents).toBe(10_000);
  });
});

describe("simulateur d'achat", () => {
  const base = (overrides: Partial<SimulationInput> = {}): SimulationInput => ({
    today: TODAY,
    horizonEnd: HORIZON,
    priceCents: 40_000,
    desiredDate: null,
    availableNowCents: 50_000,
    hasAvailableAccounts: true,
    events: events([salary, rent]),
    reserveCents: 0,
    preserveBudgets: false,
    goals: [],
    linkedGoalId: null,
    ...overrides,
  });

  it("déclare compatible un achat qui laisse les échéances couvertes", () => {
    const r = simulatePurchase(base());
    expect(r.verdict).toBe("compatible");
    expect(r.availableBeforeCents).toBe(50_000);
    expect(r.availableAfterCents).toBe(10_000);
    expect(r.minBalanceAfter).toEqual({ date: TODAY, balanceCents: 10_000 });
    expect(r.earliestDate).toBe(TODAY);
    expect(r.bills).toEqual([{ date: "2026-11-05", label: "Loyer", amountCents: 60_000, balanceAfterCents: 100_000, covered: true }]);
  });

  it("signale un achat qui entame la réserve de sécurité et propose la date pleinement compatible", () => {
    const r = simulatePurchase(base({ reserveCents: 20_000 }));
    expect(r.verdict).toBe("reduced_margin");
    expect(r.reserveKept).toBe(false);
    expect(r.marginCents).toBe(-10_000);
    expect(r.earliestDate).toBe("2026-10-28");
  });

  it("propose de reporter un achat trop important à la première date compatible", () => {
    const r = simulatePurchase(base({ priceCents: 100_000 }));
    expect(r.verdict).toBe("postpone");
    expect(r.earliestDate).toBe("2026-10-28");
  });

  it("indique quand l'achat dépend de revenus seulement estimés", () => {
    const bonus = income("2026-10-26", 60_000, "chk", { status: "planned", confirmedAt: null });
    const r = simulatePurchase(base({ priceCents: 80_000, desiredDate: "2026-10-26", events: events([salary, rent], [bonus]) }));
    expect(r.verdict).toBe("reduced_margin");
    expect(r.dependsOnEstimatedIncome).toBe(true);
    expect(r.earliestDate).toBe("2026-10-28");
  });

  it("détecte un achat qui compromet les budgets", () => {
    const evts = events([salary, rent], [], [budget("food", "weekly", 10_000)]);
    const r = simulatePurchase(base({ events: evts, preserveBudgets: true }));
    expect(r.budgetsCompromised).toBe(true);
    expect(r.verdict).toBe("postpone");
  });

  it("refuse de dater un achat sans données suffisantes", () => {
    const noIncome = simulatePurchase(base({ priceCents: 10_000, events: events([rent]) }));
    expect(noIncome.verdict).toBe("insufficient_data");
    expect(noIncome.earliestDate).toBeNull();

    expect(simulatePurchase(base({ hasAvailableAccounts: false })).verdict).toBe("insufficient_data");
    expect(simulatePurchase(base({ desiredDate: "2027-12-01" })).verdict).toBe("insufficient_data");
  });

  it("évalue l'impact sur les objectifs d'épargne", () => {
    const r = simulatePurchase(
      base({
        goals: [
          { id: "pc", name: "Ordinateur", monthlyContributionCents: 10_000, accumulatedCents: 20_000, targetCents: 100_000 },
          { id: "secu", name: "Sécurité", monthlyContributionCents: null, accumulatedCents: 0, targetCents: 50_000 },
        ],
        linkedGoalId: "pc",
      }),
    );
    expect(r.goalImpacts).toEqual([
      { goalId: "pc", name: "Ordinateur", linked: true, equivalentMonths: 4, coveragePct: 50 },
      { goalId: "secu", name: "Sécurité", linked: false, equivalentMonths: null, coveragePct: null },
    ]);
  });
});
