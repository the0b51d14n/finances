import { describe, expect, it } from "vitest";
import { computeDashboard } from "@/lib/domain/dashboard";
import { buildMonthInsights } from "@/lib/domain/insights";
import {
  averageSummaries,
  compareAmounts,
  compareCategories,
  journalMonths,
  monthEndBalances,
  recurringAnomalies,
  samePeriodDay,
  savingsFlows,
  summarizeMonth,
} from "@/lib/domain/monthly";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { account, byId, category, expense, income, rule, transfer, tx } from "./fixtures";

const TODAY = "2026-10-25";

const chk = account("chk", "checking", 100_000, "2026-08-01");
const liv = account("liv", "savings", 50_000, "2026-08-01");
const tr = account("tr", "meal_voucher", 0, "2026-08-01");
const accounts = [chk, liv, tr];
const accountsById = byId(accounts);
const categories = [
  category("food", "expense"),
  category("rent", "expense"),
  category("salary", "income"),
  category("interest", "income", "savings_interest"),
  category("mv", "income", "meal_voucher_credit"),
];

const rentRule = rule({ kind: "expense", label: "Loyer", amountCents: 60_000, accountId: "chk", startDate: "2026-08-05", trackingStart: "2026-09-01", categoryId: "rent" });
const salaryRule = rule({ kind: "income", label: "Salaire", amountCents: 150_000, accountId: "chk", startDate: "2026-08-31", trackingStart: "2026-09-01", categoryId: "salary" });

const transactions = [
  // Septembre
  income("2026-09-01", 150_000, "chk", { categoryId: "salary", recurrenceId: salaryRule.id, occurrenceDate: "2026-08-31" }),
  expense("2026-09-05", 60_000, "chk", { categoryId: "rent", recurrenceId: rentRule.id, occurrenceDate: "2026-09-05" }),
  expense("2026-09-10", 20_000, "chk", { categoryId: "food" }),
  expense("2026-09-28", 1_000, "chk", { categoryId: "food" }),
  transfer("2026-09-15", 30_000, "chk", "liv"),
  expense("2026-09-20", 5_000, "chk", { categoryId: "food", status: "planned", confirmedAt: null }),
  // Octobre (le loyer n'est pas encore comptabilisé)
  income("2026-10-01", 150_000, "chk", { categoryId: "salary", recurrenceId: salaryRule.id, occurrenceDate: "2026-09-30" }),
  income("2026-10-02", 15_000, "tr", { categoryId: "mv" }),
  tx("expense", "2026-10-12", 30_000, [["chk", -20_000], ["tr", -10_000]], { categoryId: "food" }),
  transfer("2026-10-15", 20_000, "chk", "liv"),
  income("2026-10-20", 1_000, "liv", { categoryId: "interest" }),
  tx("adjustment", "2026-10-21", 500, [["chk", -500]]),
];

const sep = summarizeMonth(transactions, "2026-09", accountsById, { today: TODAY });
const oct = summarizeMonth(transactions, "2026-10", accountsById, { today: TODAY });

describe("synthèse mensuelle", () => {
  it("exclut transferts, ajustements et opérations prévues des revenus et dépenses", () => {
    expect(sep).toMatchObject({ incomeCents: 150_000, expenseCents: 81_000, netCents: 69_000, savingsRatePct: 46, transfersCents: 30_000, provisional: false });
    expect(oct).toMatchObject({
      incomeCents: 166_000,
      expenseCents: 30_000,
      netCents: 136_000,
      savingsRatePct: 81.9,
      voucherExpenseCents: 10_000,
      voucherIncomeCents: 15_000,
      adjustmentsNetCents: -500,
      transfersCents: 20_000,
      provisional: true,
    });
  });

  it("compare à la même période du mois précédent", () => {
    expect(samePeriodDay(TODAY, "2026-10")).toBe(25);
    expect(samePeriodDay(TODAY, "2026-09")).toBeNull();
    const sepToDate = summarizeMonth(transactions, "2026-09", accountsById, { today: TODAY, upToDay: 25 });
    expect(sepToDate.expenseCents).toBe(80_000);
  });
});

describe("comparaisons", () => {
  it("calcule différence et variation, sans pourcentage trompeur", () => {
    expect(compareAmounts(30_000, 80_000)).toEqual({ currentCents: 30_000, previousCents: 80_000, diffCents: -50_000, pct: -62.5, note: null });
    expect(compareAmounts(500, 0)).toMatchObject({ diffCents: 500, pct: null, note: "new" });
    expect(compareAmounts(0, 0)).toMatchObject({ diffCents: 0, pct: null, note: "not_computable" });
    expect(compareAmounts(100, -50)).toMatchObject({ diffCents: 150, pct: null, note: "not_computable" });
    expect(compareAmounts(0, 400)).toMatchObject({ pct: -100, note: null });
  });

  it("calcule une moyenne sur les seuls mois renseignés", () => {
    const aug = summarizeMonth(transactions, "2026-08", accountsById, { today: TODAY }); // aucun mouvement
    const avg = averageSummaries([aug, sep, oct], "2026-09")!;
    expect(avg.incomeCents).toBe(158_000); // (150 000 + 166 000) / 2 : août est ignoré
    expect(avg.expenseCents).toBe(55_500);
    expect(avg.expenseByCategory.get("rent")).toBe(30_000);
    expect(averageSummaries([aug], "2026-08")).toBeNull();
  });

  it("classe les catégories par variation absolue", () => {
    const rows = compareCategories(oct.expenseByCategory, sep.expenseByCategory);
    expect(rows.map((r) => [r.categoryId, r.comparison.diffCents, r.comparison.pct])).toEqual([
      ["rent", -60_000, -100],
      ["food", 9_000, 42.9],
    ]);
  });
});

describe("épargne, soldes et échéances décalées", () => {
  it("décompose la variation de l'épargne sans compter les transferts comme une richesse nouvelle", () => {
    const flows = savingsFlows(accounts, transactions, "2026-10", byId(categories), TODAY);
    expect(flows).toMatchObject({ startCents: 80_000, endCents: 101_000, variationCents: 21_000, contributionsCents: 20_000, interestCents: 1_000 });
    expect(flows.openingsCents + flows.contributionsCents + flows.interestCents + flows.otherIncomeCents - flows.withdrawalsCents + flows.adjustmentsCents).toBe(
      flows.variationCents,
    );
  });

  it("calcule les soldes de fin de mois", () => {
    const [aug, september] = monthEndBalances(accounts, transactions, ["2026-08", "2026-09"], TODAY);
    expect(aug.totals).toMatchObject({ totalCents: 150_000, availableCents: 100_000 });
    expect(september.totals).toMatchObject({ availableCents: 139_000, savingsCents: 80_000, totalCents: 219_000 });
  });

  it("distingue un prélèvement manquant ou décalé d'une économie réelle", () => {
    const anomalies = recurringAnomalies([rentRule, salaryRule], transactions, "2026-10", TODAY);
    expect(anomalies.map((a) => [a.rule.label, a.kind, a.occurrenceDate]).sort()).toEqual([
      ["Loyer", "missing", "2026-10-05"],
      ["Salaire", "shifted_in", "2026-09-30"],
      ["Salaire", "upcoming", "2026-10-31"],
    ]);
    const sepAnomalies = recurringAnomalies([rentRule, salaryRule], transactions, "2026-09", TODAY);
    expect(sepAnomalies.map((a) => a.kind).sort()).toEqual(["shifted_in", "shifted_out"]);
  });

  it("liste les mois du journal du plus récent au plus ancien", () => {
    expect(journalMonths(accounts, transactions, TODAY)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });
});

describe("bilan automatique", () => {
  const categoryName = (id: string) => id;

  it("produit des constats justifiés par les données", () => {
    const insights = buildMonthInsights({
      current: oct,
      previous: sep,
      history: [sep, summarizeMonth(transactions, "2026-08", accountsById, { today: TODAY })],
      categoryName,
      categoryComparison: compareCategories(oct.expenseByCategory, sep.expenseByCategory),
      budgetOverruns: [],
      goalsAchieved: ["Vacances"],
      savings: savingsFlows(accounts, transactions, "2026-10", byId(categories), TODAY),
      anomalies: recurringAnomalies([rentRule, salaryRule], transactions, "2026-10", TODAY),
      monthTransactions: transactions.filter((t) => t.date.startsWith("2026-10")),
      historyTransactions: transactions.filter((t) => t.date < "2026-10-01"),
    });
    const texts = insights.map((i) => i.text.replace(/[  ]/g, " "));
    expect(texts[0]).toMatch(/provisoires/);
    expect(texts).toContainEqual(expect.stringMatching(/Principaux postes de dépenses : food \(300,00 €, 100 %\)/));
    expect(texts).toContainEqual(expect.stringMatching(/Solde net positif de 1 360,00 € \(taux d'épargne 81,9 %\)/));
    expect(texts).toContainEqual(expect.stringMatching(/Plus forte hausse : food, \+90,00 € \(\+42,9 %\)/));
    expect(texts).toContainEqual(expect.stringMatching(/Plus forte baisse : rent, -600,00 € \(-100 %\)/));
    expect(texts).toContainEqual(expect.stringMatching(/L'épargne progresse de 210,00 €/));
    expect(texts).toContainEqual("Objectif atteint : Vacances.");
    expect(texts).toContainEqual(expect.stringMatching(/ajustements de solde/));
    expect(texts).toContainEqual(expect.stringMatching(/1 échéance\(s\) récurrente\(s\).*prélèvement décalé/));
    // Un seul mois d'historique renseigné : aucune règle « inhabituel » ne s'applique.
    expect(texts.some((t) => t.startsWith("À vérifier"))).toBe(false);
  });

  it("n'affirme rien sans données", () => {
    const empty = summarizeMonth([], "2026-07", accountsById, { today: TODAY });
    const insights = buildMonthInsights({
      current: empty,
      previous: null,
      history: [],
      categoryName,
      categoryComparison: [],
      budgetOverruns: [],
      goalsAchieved: [],
      savings: null,
      anomalies: [],
      monthTransactions: [],
      historyTransactions: [],
    });
    expect(insights.map((i) => i.text)).toEqual(["Aucune opération confirmée ce mois-ci : aucun bilan ne peut être établi."]);
  });
});

describe("tableau de bord", () => {
  const dChk = account("chk", "checking", 50_000, "2026-10-01");
  const dLiv = account("liv", "savings", 100_000, "2026-10-01");
  const salary = rule({ kind: "income", label: "Salaire", amountCents: 150_000, accountId: "chk", startDate: "2026-01-28", trackingStart: TODAY });
  const rent = rule({ kind: "expense", label: "Loyer", amountCents: 60_000, accountId: "chk", startDate: "2026-01-05", trackingStart: TODAY });
  const phone = rule({ kind: "expense", label: "Téléphone", amountCents: 2_000, accountId: "chk", startDate: "2026-01-27", trackingStart: TODAY });

  const dashboard = (reserve: number) =>
    computeDashboard({
      today: TODAY,
      accounts: [dChk, dLiv],
      transactions: [],
      rules: [salary, rent, phone],
      budgets: [],
      goals: [],
      allocations: [],
      settings: { ...DEFAULT_SETTINGS, safetyReserveCents: reserve },
      categoryName: (id) => id,
    });

  it("calcule le réservé et le reste disponible jusqu'au prochain revenu", () => {
    const d = dashboard(10_000);
    expect(d.totals).toMatchObject({ availableCents: 50_000, savingsCents: 100_000, totalCents: 150_000 });
    expect(d.nextIncome?.date).toBe("2026-10-28");
    expect(d.reservedCents).toBe(2_000);
    expect(d.remainingUntilIncomeCents).toBe(38_000);
    expect(d.daysUntilIncome).toBe(3);
    expect(d.perDayCents).toBe(12_666);
    expect(d.upcomingBills.map((b) => b.label)).toEqual(["Téléphone", "Loyer"]);
    expect(d.alerts.map((a) => a.title)).toEqual(["1 échéance(s) dans les 7 prochains jours"]);
  });

  it("alerte quand la réserve de sécurité serait entamée", () => {
    const d = dashboard(60_000);
    expect(d.lowPoint).toEqual({ date: "2026-10-27", balanceCents: 48_000 });
    expect(d.alerts[0]).toMatchObject({ level: "warning", title: "Réserve de sécurité entamée" });
  });
});
