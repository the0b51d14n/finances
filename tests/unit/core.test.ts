import { describe, expect, it } from "vitest";
import { accountTypeRules, balancesAt, totalsByClass, typeChangeAllowed } from "@/lib/domain/accounts";
import { budgetPeriodRange, evaluateBudget, spentInRange } from "@/lib/domain/budgets";
import { goalAccumulated, goalProgress, overAllocatedAccounts } from "@/lib/domain/goals";
import { adjustmentFor, buildEntries, entriesToInput, expenseSplit, frequentOperations, possibleDuplicates } from "@/lib/domain/ledger";
import { listOccurrences, monthlyEquivalentCents, occurrenceDates, realizationIndex } from "@/lib/domain/recurrence";
import type { SavingsGoal } from "@/lib/domain/types";
import { account, byId, expense, income, rule, transfer, tx } from "./fixtures";

const chk = account("chk", "checking", 100_000);
const liv = account("liv", "savings", 50_000);
const tr = account("tr", "meal_voucher", 0);
const accounts = [chk, liv, tr];
const accountsById = byId(accounts);

describe("écritures d'une opération", () => {
  it("répartit une dépense entre la banque et les tickets-restaurant", () => {
    const res = buildEntries({ kind: "expense", amountCents: 3_000, accountId: "chk", voucherAccountId: "tr", voucherCents: 1_000 }, accountsById);
    expect(res).toEqual({ ok: true, entries: [{ accountId: "chk", amountCents: -2_000 }, { accountId: "tr", amountCents: -1_000 }] });
  });

  it("accepte une dépense entièrement payée en tickets", () => {
    const res = buildEntries({ kind: "expense", amountCents: 3_000, accountId: "tr", voucherAccountId: "tr", voucherCents: 3_000 }, accountsById);
    expect(res).toEqual({ ok: true, entries: [{ accountId: "tr", amountCents: -3_000 }] });
  });

  it("refuse les saisies incohérentes", () => {
    expect(buildEntries({ kind: "expense", amountCents: 1_000, accountId: "chk", voucherAccountId: "tr", voucherCents: 2_000 }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "expense", amountCents: 1_000, accountId: "chk", voucherAccountId: "liv", voucherCents: 500 }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "transfer", amountCents: 1_000, fromAccountId: "chk", toAccountId: "chk" }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "transfer", amountCents: 1_000, fromAccountId: "tr", toAccountId: "chk" }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "income", amountCents: 0, accountId: "chk" }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "income", amountCents: 1_000, accountId: "inconnu" }, accountsById).ok).toBe(false);
  });

  it("produit un transfert à somme nulle et des ajustements signés", () => {
    const t = buildEntries({ kind: "transfer", amountCents: 20_000, fromAccountId: "chk", toAccountId: "liv" }, accountsById);
    expect(t.ok && t.entries.reduce((s, e) => s + e.amountCents, 0)).toBe(0);
    expect(buildEntries({ kind: "adjustment", amountCents: 500, accountId: "chk", direction: "decrease" }, accountsById)).toEqual({
      ok: true,
      entries: [{ accountId: "chk", amountCents: -500 }],
    });
    expect(adjustmentFor(1_000, 1_500)).toEqual({ direction: "increase", amountCents: 500 });
    expect(adjustmentFor(1_000, 400)).toEqual({ direction: "decrease", amountCents: 600 });
    expect(adjustmentFor(1_000, 1_000)).toBeNull();
  });

  it("reconstitue la saisie d'origine pour l'édition", () => {
    const split = tx("expense", "2026-02-06", 3_000, [["chk", -2_000], ["tr", -1_000]]);
    expect(entriesToInput(split, accountsById)).toEqual({
      kind: "expense",
      amountCents: 3_000,
      accountId: "chk",
      voucherAccountId: "tr",
      voucherCents: 1_000,
    });
    expect(expenseSplit(split, accountsById)).toEqual({ totalCents: 3_000, voucherCents: 1_000, otherCents: 2_000 });
    expect(entriesToInput(transfer("2026-02-05", 100, "chk", "liv"), accountsById)).toEqual({
      kind: "transfer",
      amountCents: 100,
      fromAccountId: "chk",
      toAccountId: "liv",
    });
  });
});

describe("saisie rapide et doublons", () => {
  it("repère les opérations saisies deux fois, sauf annulées ou distinguées par une note", () => {
    const a = expense("2026-10-03", 1_250, "chk", { label: "Boulangerie" });
    const b = expense("2026-10-03", 1_250, "chk", { label: "boulangerie " });
    const cancelled = expense("2026-10-03", 1_250, "chk", { label: "Boulangerie", status: "cancelled", confirmedAt: null });
    const noted = expense("2026-10-03", 1_250, "chk", { label: "Boulangerie", notes: "second achat" });
    const groups = possibleDuplicates([a, b, cancelled, noted, expense("2026-10-04", 1_250, "chk", { label: "Boulangerie" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("propose les opérations répétées avec leur dernier montant, sans les échéances récurrentes", () => {
    const txs = [
      expense("2026-10-10", 450, "chk", { label: "Café", categoryId: "cat-food" }),
      expense("2026-10-02", 400, "chk", { label: "Café", categoryId: "cat-food" }),
      expense("2026-10-05", 3_000, "chk", { label: "Courses", categoryId: "cat-food" }),
      transfer("2026-10-01", 2_000, "chk", "liv", { label: "Vers Boursorama" }),
      transfer("2026-10-08", 3_000, "chk", "liv", { label: "Vers Boursorama" }),
      expense("2026-10-01", 1_500, "chk", { label: "Téléphone", recurrenceId: "r", occurrenceDate: "2026-10-01" }),
      expense("2026-10-15", 1_500, "chk", { label: "Téléphone", recurrenceId: "r", occurrenceDate: "2026-10-15" }),
      expense("2026-06-01", 999, "chk", { label: "Ancien" }),
      expense("2026-06-02", 999, "chk", { label: "Ancien" }),
    ];
    const ops = frequentOperations(txs, "2026-07-01");
    expect(ops.map((o) => [o.label, o.amountCents, o.count])).toEqual([
      ["Café", 450, 2],
      ["Vers Boursorama", 3_000, 2],
    ]);
    expect(ops[1]).toMatchObject({ kind: "transfer", accountId: "chk", toAccountId: "liv" });
  });
});

describe("soldes", () => {
  const transactions = [
    income("2026-02-01", 120_000, "chk"),
    expense("2026-02-03", 45_000, "chk"),
    transfer("2026-02-05", 20_000, "chk", "liv"),
    expense("2026-02-10", 5_000, "chk", { status: "planned", confirmedAt: null }),
    expense("2026-02-11", 7_000, "chk", { status: "cancelled", confirmedAt: null }),
    income("2026-02-01", 15_000, "tr"),
    tx("expense", "2026-02-06", 3_000, [["chk", -2_000], ["tr", -1_000]]),
  ];

  it("ne compte que les opérations confirmées", () => {
    const b = balancesAt(accounts, transactions, "2026-02-28");
    expect(b.get("chk")).toBe(153_000);
    expect(b.get("liv")).toBe(70_000);
    expect(b.get("tr")).toBe(14_000);
    expect(balancesAt(accounts, transactions, "2026-02-04").get("chk")).toBe(175_000);
  });

  it("exclut les tickets-restaurant du total et ne fausse pas le total avec les transferts", () => {
    const totals = totalsByClass(accounts, balancesAt(accounts, transactions, "2026-02-28"));
    expect(totals).toEqual({
      totalCents: 223_000,
      availableCents: 153_000,
      savingsCents: 70_000,
      reserveCents: 0,
      investmentCents: 0,
      debtCents: 0,
      voucherCents: 14_000,
      netWorthCents: 223_000,
    });
    // Total = soldes initiaux bancaires + revenus bancaires − part bancaire des dépenses : le transfert est neutre.
    expect(totals.totalCents).toBe(150_000 + 120_000 - 45_000 - 2_000);
  });

  it("compte les placements dans le total, les dettes à part et jamais dans le disponible", () => {
    const pea = account("pea", "investment", 300_000);
    const loan = account("loan", "debt", -500_000);
    const gift = account("gift", "earmarked", 2_000);
    const all = [chk, pea, loan, gift];
    const txs = [transfer("2026-02-05", 20_000, "chk", "loan"), tx("adjustment", "2026-02-10", 15_000, [["pea", 15_000]])];
    const totals = totalsByClass(all, balancesAt(all, txs, "2026-02-28"));
    expect(totals.availableCents).toBe(80_000);
    expect(totals.investmentCents).toBe(315_000);
    expect(totals.debtCents).toBe(-480_000);
    expect(totals.voucherCents).toBe(2_000);
    expect(totals.totalCents).toBe(80_000 + 315_000);
    expect(totals.netWorthCents).toBe(80_000 + 315_000 - 480_000);
    // Rembourser une dette ne change pas le patrimoine net : seule la revalorisation du PEA le modifie.
    const before = totalsByClass(all, balancesAt(all, [], "2026-02-28"));
    expect(totals.netWorthCents - before.netWorthCents).toBe(15_000);
  });

  it("applique à chaque type exactement les règles annoncées (disponible, épargne, total, patrimoine)", () => {
    const types = ["checking", "cash", "savings", "dedicated_savings", "other", "meal_voucher", "investment", "debt", "earmarked"] as const;
    for (const type of types) {
      const balance = type === "debt" ? -10_000 : 10_000;
      const acc = account("x", type, balance);
      const totals = totalsByClass([acc], balancesAt([acc], [], "2026-02-01"));
      const rules = accountTypeRules(type);
      expect(totals.availableCents, type).toBe(rules.inAvailable ? balance : 0);
      expect(totals.savingsCents, type).toBe(rules.inSavings ? balance : 0);
      expect(totals.totalCents, type).toBe(rules.inTotal ? balance : 0);
      expect(totals.netWorthCents, type).toBe(rules.inNetWorth ? balance : 0);
    }
    expect(accountTypeRules("debt").negativeBalance).toBe("required");
    expect(accountTypeRules("earmarked")).toMatchObject({ negativeBalance: "forbidden", transferable: false });
    expect(accountTypeRules("checking")).toMatchObject({ negativeBalance: "allowed", transferable: true });
  });

  it("interdit à un compte utilisé de changer de classe comptable", () => {
    expect(typeChangeAllowed("checking", "investment", false)).toBe(true);
    expect(typeChangeAllowed("checking", "investment", true)).toBe(false);
    expect(typeChangeAllowed("savings", "dedicated_savings", true)).toBe(true);
    expect(typeChangeAllowed("checking", "cash", true)).toBe(true);
    expect(typeChangeAllowed("meal_voucher", "earmarked", true)).toBe(false);
    expect(typeChangeAllowed("debt", "debt", true)).toBe(true);
  });

  it("refuse les transferts d'avantages affectés", () => {
    const gift = account("gift", "earmarked", 2_000);
    const loan = account("loan", "debt", -500_000);
    const m = byId([chk, gift, loan]);
    expect(buildEntries({ kind: "transfer", amountCents: 1_000, fromAccountId: "gift", toAccountId: "chk" }, m).ok).toBe(false);
    expect(buildEntries({ kind: "transfer", amountCents: 1_000, fromAccountId: "chk", toAccountId: "loan" }, m).ok).toBe(true);
  });

  it("applique la règle du solde initial (opérations antérieures sans effet)", () => {
    const recent = account("recent", "checking", 10_000, "2026-03-01");
    const txs = [expense("2026-02-15", 2_500, "recent"), expense("2026-03-01", 1_000, "recent")];
    expect(balancesAt([recent], txs, "2026-03-31").get("recent")).toBe(9_000);
    expect(balancesAt([recent], txs, "2026-02-28").has("recent")).toBe(false);
  });
});

describe("récurrences", () => {
  it("ancre les échéances mensuelles sur le jour de début, bornées à la fin du mois", () => {
    const r = rule({ kind: "expense", amountCents: 100, accountId: "chk", startDate: "2026-01-31" });
    expect(occurrenceDates(r, "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("gère les fréquences en jours, trimestrielles, annuelles et la date de fin", () => {
    expect(occurrenceDates({ frequency: "biweekly", startDate: "2026-01-05", endDate: null }, "2026-02-01", "2026-02-28")).toEqual([
      "2026-02-02",
      "2026-02-16",
    ]);
    expect(occurrenceDates({ frequency: "weekly", startDate: "2026-01-01", endDate: "2026-01-20" }, "2025-01-01", "2026-12-31")).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
    ]);
    expect(occurrenceDates({ frequency: "quarterly", startDate: "2025-11-15", endDate: null }, "2026-06-01", "2026-12-31")).toEqual([
      "2026-08-15",
      "2026-11-15",
    ]);
    expect(occurrenceDates({ frequency: "annual", startDate: "2024-02-29", endDate: null }, "2025-01-01", "2028-12-31")).toEqual([
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
    expect(occurrenceDates({ frequency: "daily", startDate: "2026-01-01", endDate: null }, "2026-01-30", "2026-02-02")).toHaveLength(4);
  });

  it("attribue un statut à chaque échéance sans jamais compter une échéance prévue comme effectuée", () => {
    const r = rule({ kind: "expense", amountCents: 45_000, accountId: "chk", startDate: "2026-01-05", trackingStart: "2026-02-01" });
    const realized = expense("2026-02-06", 45_000, "chk", { recurrenceId: r.id, occurrenceDate: "2026-02-05" });
    const skipped = expense("2026-03-05", 45_000, "chk", {
      recurrenceId: r.id,
      occurrenceDate: "2026-03-05",
      status: "cancelled",
      confirmedAt: null,
    });
    const occ = listOccurrences(r, "2026-01-01", "2026-05-31", "2026-04-10", realizationIndex([realized, skipped]));
    expect(occ.map((o) => [o.date, o.status])).toEqual([
      ["2026-01-05", "untracked"],
      ["2026-02-05", "realized"],
      ["2026-03-05", "skipped"],
      ["2026-04-05", "overdue"],
      ["2026-05-05", "pending"],
    ]);
    const inactive = listOccurrences({ ...r, isActive: false }, "2026-01-01", "2026-05-31", "2026-04-10", realizationIndex([realized]));
    expect(inactive.map((o) => o.status)).toEqual(["realized"]);
  });

  it("calcule un équivalent mensuel", () => {
    expect(monthlyEquivalentCents(1_000, "weekly")).toBe(4_333);
    expect(monthlyEquivalentCents(12_000, "annual")).toBe(1_000);
    expect(monthlyEquivalentCents(3_000, "quarterly")).toBe(1_000);
  });
});

describe("budgets", () => {
  it("utilise des périodes calendaires", () => {
    expect(budgetPeriodRange("weekly", "2026-10-25")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(budgetPeriodRange("monthly", "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("ne compte que les dépenses confirmées de la catégorie et de la période", () => {
    const txs = [
      expense("2026-10-20", 3_000, "chk", { categoryId: "food" }),
      expense("2026-10-21", 2_000, "chk", { categoryId: "food", status: "planned", confirmedAt: null }),
      expense("2026-10-18", 1_000, "chk", { categoryId: "food" }),
      expense("2026-10-22", 500, "chk", { categoryId: "fun" }),
      tx("expense", "2026-10-23", 3_000, [["chk", -2_000], ["tr", -1_000]], { categoryId: "food" }),
    ];
    expect(spentInRange(txs, "food", budgetPeriodRange("weekly", "2026-10-21"))).toBe(6_000);
  });

  it("évalue consommation, projection et niveau d'alerte", () => {
    const range = { start: "2026-10-19", end: "2026-10-25" };
    const warning = evaluateBudget({ amountCents: 8_000, alertPct: 80, spentCents: 7_000, plannedCents: 0, range, today: "2026-10-21" });
    expect(warning).toMatchObject({ level: "warning", consumedPct: 87.5, remainingCents: 1_000, projectionCents: 16_333, projectedOverrun: true });
    const exceeded = evaluateBudget({ amountCents: 8_000, alertPct: 80, spentCents: 9_000, plannedCents: 0, range, today: "2026-10-25" });
    expect(exceeded).toMatchObject({ level: "exceeded", remainingCents: -1_000 });
    const ok = evaluateBudget({ amountCents: 8_000, alertPct: 80, spentCents: 1_000, plannedCents: 3_000, range, today: "2026-10-25" });
    expect(ok).toMatchObject({ level: "ok", projectionCents: 4_000 });
  });
});

describe("objectifs d'épargne", () => {
  it("calcule progression, effort mensuel nécessaire et date estimée", () => {
    const p = goalProgress({ targetCents: 100_000, accumulatedCents: 25_000, targetDate: "2027-04-25", monthlyContributionCents: 10_000, today: "2026-10-25" });
    expect(p).toMatchObject({
      remainingCents: 75_000,
      pct: 25,
      monthsLeft: 6,
      neededPerMonthCents: 12_500,
      estimatedDate: "2027-06-25",
      onTrack: false,
      achieved: false,
    });
    const done = goalProgress({ targetCents: 100, accumulatedCents: 150, targetDate: null, monthlyContributionCents: null, today: "2026-10-25" });
    expect(done).toMatchObject({ achieved: true, remainingCents: 0 });
    const noData = goalProgress({ targetCents: 100, accumulatedCents: 0, targetDate: null, monthlyContributionCents: null, today: "2026-10-25" });
    expect(noData.estimatedDate).toBeNull();
  });

  it("n'ajoute jamais le montant d'un objectif aux soldes et détecte les affectations excessives", () => {
    const base: Omit<SavingsGoal, "id" | "tracking" | "accountId"> = {
      name: "g",
      targetCents: 100_000,
      targetDate: null,
      monthlyContributionCents: null,
      priority: 2,
      achievedAt: null,
      archivedAt: null,
      notes: null,
    };
    const balances = new Map([["liv", 70_000]]);
    expect(goalAccumulated({ id: "g0", tracking: "account", accountId: "liv" }, [], balances)).toBe(70_000);
    expect(goalAccumulated({ id: "g0", tracking: "account", accountId: "liv" }, [], new Map([["liv", -10]]))).toBe(0);
    const goals: SavingsGoal[] = [
      { ...base, id: "g1", tracking: "manual", accountId: "liv" },
      { ...base, id: "g2", tracking: "manual", accountId: "liv" },
    ];
    const allocations = [
      { id: "a1", goalId: "g1", date: "2026-01-01", amountCents: 50_000, note: null },
      { id: "a2", goalId: "g2", date: "2026-01-01", amountCents: 30_000, note: null },
    ];
    expect(overAllocatedAccounts(goals, allocations, balances)).toEqual([{ accountId: "liv", allocatedCents: 80_000, balanceCents: 70_000 }]);
  });
});
