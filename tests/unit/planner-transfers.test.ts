import { describe, expect, it } from "vitest";
import { buildForecastEvents } from "@/lib/domain/forecast";
import { planPurchases, type PlanItem } from "@/lib/domain/planner";
import { suggestTransfers } from "@/lib/domain/transfers";
import type { Transaction } from "@/lib/domain/types";
import { account, expense, rule } from "./fixtures";

const TODAY = "2026-10-26";
const HORIZON = "2027-12-31";

// Caisse d'Épargne (salaires + charges obligatoires), Boursorama (dépenses), Livret A.
const ce = account("ce", "checking", 80_000, "2026-10-01", { institution: "Caisse d'Épargne" });
const bourso = account("bourso", "checking", 5_000, "2026-10-01", { institution: "Boursorama" });
const livret = account("livret", "savings", 300_000, "2026-10-01", { institution: "Caisse d'Épargne" });
const accounts = [ce, bourso, livret];

const rules = [
  rule({ kind: "income", label: "Salaire", amountCents: 140_000, accountId: "ce", startDate: "2026-01-28", trackingStart: TODAY }),
  rule({ kind: "expense", label: "Abonnement bus", amountCents: 3_000, accountId: "ce", startDate: "2026-01-01", trackingStart: TODAY }),
  rule({ kind: "expense", label: "Téléphone", amountCents: 2_000, accountId: "ce", startDate: "2026-01-05", trackingStart: TODAY }),
  rule({ kind: "expense", label: "Claude", amountCents: 2_000, accountId: "bourso", startDate: "2026-01-10", trackingStart: TODAY }),
];

const eventsWith = (transactions: Transaction[] = [], extraRules = rules) =>
  buildForecastEvents({ today: TODAY, horizonEnd: HORIZON, accounts, rules: extraRules, transactions, budgets: [] });

const balances = new Map([
  ["ce", 80_000],
  ["bourso", 5_000],
  ["livret", 300_000],
]);

describe("virements conseillés", () => {
  it("propose de renflouer Boursorama depuis la Caisse d'Épargne avant le découvert", () => {
    const groceries = expense("2026-10-30", 6_000, "bourso", { status: "planned", confirmedAt: null });
    const suggestions = suggestTransfers({ today: TODAY, accounts, balances, events: eventsWith([groceries]), withBudgets: false });
    expect(suggestions).toEqual([
      { fromAccountId: "ce", toAccountId: "bourso", amountCents: 3_000, byDate: "2026-10-29", shortfallDate: "2026-10-30", shortfallCents: 3_000, covered: true },
    ]);
  });

  it("arrondit à 10 € et ne propose jamais l'épargne comme source", () => {
    const purchase = expense("2026-11-02", 5_550, "bourso", { status: "planned", confirmedAt: null });
    const [s] = suggestTransfers({ today: TODAY, accounts, balances, events: eventsWith([purchase]), withBudgets: false });
    expect(s.shortfallCents).toBe(2_550); // 50 − 55,50 − 20 (Claude le 10/11)
    expect(s.amountCents).toBe(3_000);
    expect(s.fromAccountId).toBe("ce");
  });

  it("signale un découvert impossible à couvrir par un autre compte courant", () => {
    const big = expense("2026-10-27", 200_000, "bourso", { status: "planned", confirmedAt: null });
    const [s] = suggestTransfers({ today: TODAY, accounts, balances, events: eventsWith([big]), withBudgets: false });
    expect(s.covered).toBe(false);
  });

  it("tient compte des virements internes programmés entre comptes courants", () => {
    const monthly = rule({ kind: "transfer", amountCents: 10_000, accountId: "ce", toAccountId: "bourso", startDate: "2026-10-29", trackingStart: TODAY });
    const groceries = expense("2026-10-30", 6_000, "bourso", { status: "planned", confirmedAt: null });
    const events = eventsWith([groceries], [...rules, monthly]);
    expect(events.find((e) => e.ruleId === monthly.id)).toMatchObject({ deltaCents: 0, date: "2026-10-29" });
    expect(suggestTransfers({ today: TODAY, accounts, balances, events, withBudgets: false })).toEqual([]);
  });
});

describe("planification des achats d'emménagement", () => {
  const item = (partial: Partial<PlanItem> & Pick<PlanItem, "id" | "priceCents" | "priority">): PlanItem => ({
    name: partial.id,
    notBefore: null,
    deadline: null,
    accountId: "bourso",
    categoryId: null,
    order: 0,
    ...partial,
  });

  const plan = (items: PlanItem[]) =>
    planPurchases({ today: TODAY, horizonEnd: HORIZON, availableNowCents: 85_000, events: eventsWith(), reserveCents: 20_000, preserveBudgets: false, items });

  it("place chaque achat au plus tôt en cumulant les achats précédents", () => {
    const result = plan([
      item({ id: "canape", priceCents: 150_000, priority: 2, order: 3 }),
      item({ id: "table", priceCents: 10_000, priority: 3, notBefore: "2026-12-01", order: 4 }),
      item({ id: "frigo", priceCents: 60_000, priority: 1, order: 2 }),
      item({ id: "lit", priceCents: 40_000, priority: 1, deadline: "2026-11-15", order: 1 }),
    ]);
    expect(result.entries.map((e) => [e.item.id, e.date, e.status, e.cumulativeCents, e.availableAfterCents])).toEqual([
      ["lit", "2026-10-26", "scheduled", 40_000, 45_000],
      ["frigo", "2026-10-28", "scheduled", 100_000, 125_000],
      ["canape", "2026-11-28", "scheduled", 250_000, 108_000],
      ["table", "2026-12-01", "scheduled", 260_000, 95_000],
    ]);
    expect(result.scheduledCents).toBe(260_000);
    // Jamais sous la réserve une fois tous les achats placés.
    expect(Math.min(...result.points.map((p) => p.balanceCents))).toBeGreaterThanOrEqual(20_000);
  });

  it("signale un achat qui ne peut pas respecter sa date limite et chiffre le manque", () => {
    const [entry] = plan([item({ id: "cuisine", priceCents: 500_000, priority: 1, deadline: "2026-11-15" })]).entries;
    expect(entry).toMatchObject({ date: "2027-01-28", status: "late", deadlineShortfallCents: 302_000 });
  });

  it("refuse de dater un achat hors de portée", () => {
    const [entry] = plan([item({ id: "voiture", priceCents: 10_000_000, priority: 1 })]).entries;
    expect(entry).toMatchObject({ date: null, status: "unschedulable" });
  });
});
