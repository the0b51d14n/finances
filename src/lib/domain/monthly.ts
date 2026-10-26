/**
 * Analyses mensuelles.
 *
 * Définitions (opérations CONFIRMÉES uniquement, datées dans le mois) :
 *  - Revenus  = somme des opérations de type revenu (y compris les crédits
 *               de tickets-restaurant, affichés à part) ;
 *  - Dépenses = somme des opérations de type dépense (montant total, quelle
 *               que soit la part payée en tickets-restaurant) ;
 *  - Solde net = revenus − dépenses ;
 *  - Taux d'épargne = solde net / revenus (non calculable si revenus nuls).
 * Les transferts internes et les ajustements de solde ne sont jamais des
 * revenus ni des dépenses : ils sont présentés séparément.
 */
import type { Cents } from "@/lib/money";
import {
  addMonthsToKey,
  daysInMonth,
  endOfMonth,
  minDate,
  monthKeyOf,
  monthRange,
  parts,
  startOfMonth,
  type IsoDate,
  type MonthKey,
} from "@/lib/dates";
import { accountClass, balancesAt, totalsByClass, type BalanceTotals } from "./accounts";
import { listOccurrences, realizationIndex } from "./recurrence";
import type { Account, Category, RecurringRule, Transaction } from "./types";

export type MonthSummary = {
  month: MonthKey;
  incomeCents: Cents;
  expenseCents: Cents;
  netCents: Cents;
  savingsRatePct: number | null;
  expenseByCategory: Map<string, Cents>;
  incomeByCategory: Map<string, Cents>;
  voucherExpenseCents: Cents;
  voucherIncomeCents: Cents;
  transfersCents: Cents;
  transferCount: number;
  adjustmentsNetCents: Cents;
  exceptionalExpenseCents: Cents;
  transactionCount: number;
  /** Mois en cours ou futur : chiffres provisoires. */
  provisional: boolean;
  /** Dernier jour pris en compte (comparaison « même période »). */
  upToDay: number | null;
};

export function summarizeMonth(
  transactions: Transaction[],
  month: MonthKey,
  accountsById: Map<string, Account>,
  options: { today: IsoDate; upToDay?: number },
): MonthSummary {
  const start = startOfMonth(month);
  let end = endOfMonth(month);
  if (options.upToDay) {
    const { year, month: m } = parts(start);
    end = `${month}-${String(Math.min(options.upToDay, daysInMonth(year, m))).padStart(2, "0")}`;
  }

  const summary: MonthSummary = {
    month,
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    savingsRatePct: null,
    expenseByCategory: new Map(),
    incomeByCategory: new Map(),
    voucherExpenseCents: 0,
    voucherIncomeCents: 0,
    transfersCents: 0,
    transferCount: 0,
    adjustmentsNetCents: 0,
    exceptionalExpenseCents: 0,
    transactionCount: 0,
    provisional: endOfMonth(month) >= options.today,
    upToDay: options.upToDay ?? null,
  };

  const isVoucher = (accountId: string) => accountsById.get(accountId)?.type === "meal_voucher";

  for (const tx of transactions) {
    if (tx.status !== "confirmed" || tx.date < start || tx.date > end) continue;
    summary.transactionCount += 1;
    switch (tx.kind) {
      case "income": {
        summary.incomeCents += tx.amountCents;
        const key = tx.categoryId ?? "";
        summary.incomeByCategory.set(key, (summary.incomeByCategory.get(key) ?? 0) + tx.amountCents);
        for (const e of tx.entries) if (isVoucher(e.accountId)) summary.voucherIncomeCents += e.amountCents;
        break;
      }
      case "expense": {
        summary.expenseCents += tx.amountCents;
        const key = tx.categoryId ?? "";
        summary.expenseByCategory.set(key, (summary.expenseByCategory.get(key) ?? 0) + tx.amountCents);
        for (const e of tx.entries) if (isVoucher(e.accountId)) summary.voucherExpenseCents += -e.amountCents;
        if (tx.isExceptional) summary.exceptionalExpenseCents += tx.amountCents;
        break;
      }
      case "transfer":
        summary.transfersCents += tx.amountCents;
        summary.transferCount += 1;
        break;
      case "adjustment":
        for (const e of tx.entries) summary.adjustmentsNetCents += e.amountCents;
        break;
    }
  }

  summary.netCents = summary.incomeCents - summary.expenseCents;
  summary.savingsRatePct =
    summary.incomeCents > 0 ? Math.round((summary.netCents / summary.incomeCents) * 1000) / 10 : null;
  return summary;
}

// -----------------------------------------------------------------------------
// Comparaisons
// -----------------------------------------------------------------------------

/**
 * note :
 *  - "new"            : précédent nul, actuel positif (nouvelle dépense / nouveau revenu)
 *  - "not_computable" : précédent nul ou négatif : un pourcentage serait trompeur
 *  - null             : pourcentage calculé normalement (précédent > 0)
 */
export type Comparison = {
  currentCents: Cents;
  previousCents: Cents;
  diffCents: Cents;
  pct: number | null;
  note: "new" | "not_computable" | null;
};

export function compareAmounts(currentCents: Cents, previousCents: Cents): Comparison {
  const diffCents = currentCents - previousCents;
  if (previousCents > 0) {
    return { currentCents, previousCents, diffCents, pct: Math.round((diffCents / previousCents) * 1000) / 10, note: null };
  }
  if (previousCents === 0 && currentCents > 0) {
    return { currentCents, previousCents, diffCents, pct: null, note: "new" };
  }
  return { currentCents, previousCents, diffCents, pct: null, note: "not_computable" };
}

export type CategoryComparison = { categoryId: string; comparison: Comparison };

/** Comparaison par catégorie, triée par variation absolue décroissante. */
export function compareCategories(current: Map<string, Cents>, previous: Map<string, Cents>): CategoryComparison[] {
  const ids = new Set([...current.keys(), ...previous.keys()]);
  return [...ids]
    .map((categoryId) => ({ categoryId, comparison: compareAmounts(current.get(categoryId) ?? 0, previous.get(categoryId) ?? 0) }))
    .sort((a, b) => Math.abs(b.comparison.diffCents) - Math.abs(a.comparison.diffCents));
}

/**
 * Moyenne de plusieurs mois (comparaison avec « plusieurs mois antérieurs »).
 * Seuls les mois renseignés (au moins une opération) entrent dans la moyenne.
 */
export function averageSummaries(summaries: MonthSummary[], label: MonthKey): MonthSummary | null {
  const used = summaries.filter((s) => s.transactionCount > 0);
  if (used.length === 0) return null;
  const avg = (pick: (s: MonthSummary) => number) => Math.round(used.reduce((sum, s) => sum + pick(s), 0) / used.length);
  const avgMap = (pick: (s: MonthSummary) => Map<string, Cents>) => {
    const keys = new Set(used.flatMap((s) => [...pick(s).keys()]));
    return new Map([...keys].map((k) => [k, avg((s) => pick(s).get(k) ?? 0)]));
  };
  const incomeCents = avg((s) => s.incomeCents);
  const expenseCents = avg((s) => s.expenseCents);
  const netCents = incomeCents - expenseCents;
  return {
    month: label,
    incomeCents,
    expenseCents,
    netCents,
    savingsRatePct: incomeCents > 0 ? Math.round((netCents / incomeCents) * 1000) / 10 : null,
    expenseByCategory: avgMap((s) => s.expenseByCategory),
    incomeByCategory: avgMap((s) => s.incomeByCategory),
    voucherExpenseCents: avg((s) => s.voucherExpenseCents),
    voucherIncomeCents: avg((s) => s.voucherIncomeCents),
    transfersCents: avg((s) => s.transfersCents),
    transferCount: avg((s) => s.transferCount),
    adjustmentsNetCents: avg((s) => s.adjustmentsNetCents),
    exceptionalExpenseCents: avg((s) => s.exceptionalExpenseCents),
    transactionCount: avg((s) => s.transactionCount),
    provisional: false,
    upToDay: null,
  };
}

/** Jour retenu pour comparer « à la même période » : jour courant si le mois est en cours. */
export function samePeriodDay(today: IsoDate, month: MonthKey): number | null {
  return monthKeyOf(today) === month ? parts(today).day : null;
}

// -----------------------------------------------------------------------------
// Soldes et épargne
// -----------------------------------------------------------------------------

export type MonthBalances = { month: MonthKey; asOf: IsoDate; totals: BalanceTotals };

/** Soldes en fin de mois (ou à aujourd'hui pour le mois en cours). */
export function monthEndBalances(accounts: Account[], transactions: Transaction[], months: MonthKey[], today: IsoDate): MonthBalances[] {
  return months.map((month) => {
    const asOf = minDate(endOfMonth(month), today);
    return { month, asOf, totals: totalsByClass(accounts, balancesAt(accounts, transactions, asOf)) };
  });
}

export type SavingsFlows = {
  startCents: Cents;
  endCents: Cents;
  variationCents: Cents;
  /** Versements nets depuis/vers des comptes hors épargne (transferts). */
  contributionsCents: Cents;
  interestCents: Cents;
  otherIncomeCents: Cents;
  withdrawalsCents: Cents; // dépenses payées depuis l'épargne
  adjustmentsCents: Cents;
  openingsCents: Cents; // soldes initiaux de comptes d'épargne ouverts dans le mois
  internalTransfersCents: Cents; // tous les transferts internes du mois
};

/**
 * Décomposition de la variation de l'épargne sur un mois. Identité vérifiée :
 * variation = ouvertures + versements nets + intérêts + autres revenus − retraits + ajustements.
 */
export function savingsFlows(
  accounts: Account[],
  transactions: Transaction[],
  month: MonthKey,
  categoriesById: Map<string, Category>,
  today: IsoDate,
): SavingsFlows {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const isSavings = (id: string) => {
    const a = accountsById.get(id);
    return !!a && accountClass(a.type) === "savings";
  };
  const start = startOfMonth(month);
  const end = minDate(endOfMonth(month), today);
  const prevEnd = endOfMonth(addMonthsToKey(month, -1));

  const sumSavings = (asOf: IsoDate) => {
    const balances = balancesAt(accounts, transactions, asOf);
    let total = 0;
    for (const a of accounts) if (isSavings(a.id)) total += balances.get(a.id) ?? 0;
    return total;
  };

  const flows: SavingsFlows = {
    startCents: sumSavings(prevEnd),
    endCents: sumSavings(end),
    variationCents: 0,
    contributionsCents: 0,
    interestCents: 0,
    otherIncomeCents: 0,
    withdrawalsCents: 0,
    adjustmentsCents: 0,
    openingsCents: 0,
    internalTransfersCents: 0,
  };
  flows.variationCents = flows.endCents - flows.startCents;

  for (const a of accounts) {
    if (isSavings(a.id) && a.openingBalanceDate >= start && a.openingBalanceDate <= end) flows.openingsCents += a.openingBalanceCents;
  }

  for (const tx of transactions) {
    if (tx.status !== "confirmed" || tx.date < start || tx.date > end) continue;
    if (tx.kind === "transfer") flows.internalTransfersCents += tx.amountCents;
    for (const e of tx.entries) {
      if (!isSavings(e.accountId)) continue;
      const account = accountsById.get(e.accountId)!;
      if (tx.date < account.openingBalanceDate) continue;
      switch (tx.kind) {
        case "transfer": {
          const other = tx.entries.find((o) => o !== e);
          if (other && !isSavings(other.accountId)) flows.contributionsCents += e.amountCents;
          break;
        }
        case "income": {
          const key = tx.categoryId ? categoriesById.get(tx.categoryId)?.systemKey : null;
          if (key === "savings_interest") flows.interestCents += e.amountCents;
          else flows.otherIncomeCents += e.amountCents;
          break;
        }
        case "expense":
          flows.withdrawalsCents += -e.amountCents;
          break;
        case "adjustment":
          flows.adjustmentsCents += e.amountCents;
          break;
      }
    }
  }
  return flows;
}

// -----------------------------------------------------------------------------
// Échéances récurrentes décalées ou manquantes
// -----------------------------------------------------------------------------

export type RecurringAnomaly = {
  rule: RecurringRule;
  occurrenceDate: IsoDate;
  /**
   *  - missing     : échéance du mois passée et non comptabilisée
   *  - shifted_out : échéance du mois comptabilisée dans un autre mois
   *  - shifted_in  : opération du mois correspondant à l'échéance d'un autre mois
   *  - upcoming    : échéance du mois encore à venir
   */
  kind: "missing" | "shifted_out" | "shifted_in" | "upcoming";
  transaction: Transaction | null;
};

/**
 * Évite de confondre un prélèvement décalé avec une économie réelle : liste
 * les échéances attendues dans le mois qui n'y sont pas comptabilisées et les
 * opérations du mois qui appartiennent à un autre mois.
 */
export function recurringAnomalies(rules: RecurringRule[], transactions: Transaction[], month: MonthKey, today: IsoDate): RecurringAnomaly[] {
  const index = realizationIndex(transactions);
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const result: RecurringAnomaly[] = [];

  for (const rule of rules) {
    if (rule.kind === "transfer") continue;
    for (const occ of listOccurrences(rule, start, end, today, index)) {
      if (occ.status === "overdue") result.push({ rule, occurrenceDate: occ.date, kind: "missing", transaction: null });
      else if (occ.status === "pending") result.push({ rule, occurrenceDate: occ.date, kind: "upcoming", transaction: null });
      else if (occ.status === "realized" && occ.transaction && monthKeyOf(occ.transaction.date) !== month) {
        result.push({ rule, occurrenceDate: occ.date, kind: "shifted_out", transaction: occ.transaction });
      }
    }
  }

  const rulesById = new Map(rules.map((r) => [r.id, r]));
  for (const tx of transactions) {
    if (tx.status !== "confirmed" || !tx.recurrenceId || !tx.occurrenceDate) continue;
    if (tx.date < start || tx.date > end || monthKeyOf(tx.occurrenceDate) === month) continue;
    const rule = rulesById.get(tx.recurrenceId);
    if (rule && rule.kind !== "transfer") result.push({ rule, occurrenceDate: tx.occurrenceDate, kind: "shifted_in", transaction: tx });
  }
  return result;
}

// -----------------------------------------------------------------------------
// Journal mensuel
// -----------------------------------------------------------------------------

/** Mois couverts par les données, du plus récent au plus ancien (opération ou solde initial). */
export function journalMonths(accounts: Account[], transactions: Transaction[], today: IsoDate): MonthKey[] {
  const current = monthKeyOf(today);
  let earliest = current;
  for (const a of accounts) if (monthKeyOf(a.openingBalanceDate) < earliest) earliest = monthKeyOf(a.openingBalanceDate);
  for (const tx of transactions) {
    if (tx.status === "confirmed" && monthKeyOf(tx.date) < earliest) earliest = monthKeyOf(tx.date);
  }
  return monthRange(earliest, current).reverse();
}
