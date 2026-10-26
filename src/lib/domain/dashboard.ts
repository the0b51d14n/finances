/**
 * Indicateurs du tableau de bord. Définitions (docs/REGLES-COMPTABLES.md) :
 *
 *  - Total des soldes      : disponible + épargne + réserves, hors tickets-restaurant.
 *  - Argent disponible     : comptes courants + espèces (soldes constatés).
 *  - Épargne totale        : livrets + épargne spécifique (soldes constatés).
 *  - Affecté aux objectifs : part de ces soldes réservée aux objectifs ; jamais ajoutée.
 *  - Réservé aux échéances : sorties programmées sur le disponible d'ici la
 *                            prochaine entrée d'argent certaine (ou 30 jours).
 *  - Reste jusqu'au prochain revenu : disponible − réservé − réserve de sécurité.
 *  - Revenus / dépenses du mois : opérations confirmées du mois calendaire.
 */
import type { Cents } from "@/lib/money";
import { addDays, addMonthsToKey, diffDays, formatDate, monthKeyOf, monthRange, type IsoDate } from "@/lib/dates";
import { accountClass, balancesAt, totalsByClass, type BalanceTotals } from "./accounts";
import { budgetPeriodRange, evaluateBudget, inRange, spentInRange, type BudgetEvaluation } from "./budgets";
import {
  FORECAST_HORIZON_DAYS,
  buildForecastEvents,
  includeEvent,
  minBalance,
  nextIncome,
  projectDaily,
  scheduledOutflows,
  type ForecastEvent,
} from "./forecast";
import { goalAccumulated, overAllocatedAccounts } from "./goals";
import { monthEndBalances, summarizeMonth, type MonthBalances, type MonthSummary } from "./monthly";
import { SIMULATION_WINDOW_DAYS } from "./simulator";
import { suggestTransfers, type TransferSuggestion } from "./transfers";
import type { Account, Budget, GoalAllocation, RecurringRule, SavingsGoal, Transaction, UserSettings } from "./types";

export const DEFAULT_RESERVATION_DAYS = 30;
export const LOW_BALANCE_LOOKAHEAD_DAYS = 30;
export const VOUCHER_EXPIRY_WARNING_DAYS = 30;

export type DashboardAlert = {
  level: "danger" | "warning" | "info";
  title: string;
  detail?: string;
  href?: string;
};

export type BudgetStatus = { budget: Budget; evaluation: BudgetEvaluation };

export type DashboardInput = {
  today: IsoDate;
  accounts: Account[];
  transactions: Transaction[];
  rules: RecurringRule[];
  budgets: Budget[];
  goals: SavingsGoal[];
  allocations: GoalAllocation[];
  settings: UserSettings;
  categoryName: (id: string) => string;
};

/** Horizon de prévision : 12 mois + la fenêtre de contrôle du simulateur. */
export function horizonEnd(today: IsoDate): IsoDate {
  return addDays(today, FORECAST_HORIZON_DAYS + SIMULATION_WINDOW_DAYS);
}

export function forecastEventsFor(
  input: Pick<DashboardInput, "today" | "accounts" | "transactions" | "rules" | "budgets"> & { settings?: Pick<UserSettings, "spendingAccountId"> },
): ForecastEvent[] {
  return buildForecastEvents({
    today: input.today,
    horizonEnd: horizonEnd(input.today),
    accounts: input.accounts,
    rules: input.rules,
    transactions: input.transactions,
    budgets: input.budgets,
    spendingAccountId: input.settings?.spendingAccountId ?? null,
  });
}

/** État de chaque budget actif sur sa période en cours. */
export function computeBudgetStatuses(
  budgets: Budget[],
  transactions: Transaction[],
  events: ForecastEvent[],
  today: IsoDate,
  defaultAlertPct: number,
): BudgetStatus[] {
  return budgets
    .filter((b) => b.isActive)
    .map((budget) => {
      const range = budgetPeriodRange(budget.period, today);
      const plannedCents = events
        .filter((e) => e.source !== "budget" && e.kind === "expense" && e.categoryId === budget.categoryId && inRange(e.date, range))
        .reduce((sum, e) => sum + e.grossCents, 0);
      return {
        budget,
        evaluation: evaluateBudget({
          amountCents: budget.amountCents,
          alertPct: budget.alertPct ?? defaultAlertPct,
          spentCents: spentInRange(transactions, budget.categoryId, range),
          plannedCents,
          range,
          today,
        }),
      };
    });
}

export type DashboardData = {
  today: IsoDate;
  hasAccounts: boolean;
  balances: Map<string, Cents>;
  totals: BalanceTotals;
  allocatedToGoalsCents: Cents;
  month: MonthSummary;
  nextIncome: ForecastEvent | null;
  reservedUntil: IsoDate;
  reservedCents: Cents;
  /** Sorties qui composent reservedCents (détail du reste à vivre). */
  reservedEvents: ForecastEvent[];
  remainingUntilIncomeCents: Cents;
  daysUntilIncome: number | null;
  perDayCents: Cents | null;
  upcomingBills: ForecastEvent[];
  upcomingIncomes: ForecastEvent[];
  overdue: ForecastEvent[];
  lowPoint: { date: IsoDate; balanceCents: Cents } | null;
  budgets: BudgetStatus[];
  history: MonthBalances[];
  transfers: TransferSuggestion[];
  alerts: DashboardAlert[];
};

export function computeDashboard(input: DashboardInput): DashboardData {
  const { today, accounts, transactions, settings } = input;
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const balances = balancesAt(accounts, transactions, today);
  const totals = totalsByClass(accounts, balances);
  const events = forecastEventsFor(input);
  const month = summarizeMonth(transactions, monthKeyOf(today), accountsById, { today });

  const income = nextIncome(events, "guaranteed", today);
  const reservedUntil = income ? income.date : addDays(today, DEFAULT_RESERVATION_DAYS);
  const reservedEvents = scheduledOutflows(events, today, reservedUntil);
  const reservedCents = reservedEvents.reduce((s, e) => s - e.deltaCents, 0);
  const remainingUntilIncomeCents = totals.availableCents - reservedCents - settings.safetyReserveCents;
  const daysUntilIncome = income ? Math.max(1, diffDays(today, income.date)) : null;
  const perDayCents = daysUntilIncome ? Math.floor(Math.max(0, remainingUntilIncomeCents) / daysUntilIncome) : null;

  const in30 = addDays(today, 30);
  const upcomingBills = events.filter((e) => e.source !== "budget" && e.deltaCents < 0 && e.date <= in30).slice(0, 8);
  const upcomingIncomes = events.filter((e) => e.kind === "income" && e.deltaCents > 0 && e.date <= addDays(today, 60)).slice(0, 6);
  const overdue = events.filter((e) => e.overdue);

  const lookaheadEnd = addDays(today, LOW_BALANCE_LOOKAHEAD_DAYS);
  const points = projectDaily(totals.availableCents, events, today, lookaheadEnd, (e) =>
    includeEvent(e, "guaranteed", settings.preserveBudgetsInForecast),
  );
  const lowPoint = minBalance(points, today, lookaheadEnd);

  const budgets = computeBudgetStatuses(input.budgets, transactions, events, today, settings.budgetAlertPct);

  const activeGoals = input.goals.filter((g) => !g.archivedAt);
  const allocatedToGoalsCents = activeGoals.reduce((s, g) => s + goalAccumulated(g, input.allocations, balances), 0);

  const currentMonth = monthKeyOf(today);
  const history = monthEndBalances(accounts, transactions, monthRange(addMonthsToKey(currentMonth, -5), currentMonth), today);
  const transfers = suggestTransfers({ today, accounts, balances, events, withBudgets: settings.preserveBudgetsInForecast });

  // --- Alertes ---------------------------------------------------------------
  const alerts: DashboardAlert[] = [];
  const hasAccounts = accounts.some((a) => !a.archivedAt);

  if (settings.notifyLowBalance && lowPoint && accounts.some((a) => !a.archivedAt && accountClass(a.type) === "available")) {
    if (lowPoint.balanceCents < 0) {
      alerts.push({
        level: "danger",
        title: "Découvert prévu",
        detail: `Le solde disponible pourrait devenir négatif le ${formatDate(lowPoint.date)}.`,
        href: "/previsions",
      });
    } else if (lowPoint.balanceCents < settings.safetyReserveCents) {
      alerts.push({
        level: "warning",
        title: "Réserve de sécurité entamée",
        detail: `Le solde disponible prévu passe sous votre réserve le ${formatDate(lowPoint.date)}.`,
        href: "/previsions",
      });
    }
  }
  if (overdue.length > 0) {
    alerts.push({
      level: "warning",
      title: `${overdue.length} échéance(s) à confirmer`,
      detail: "Des opérations prévues ont une date passée : confirmez-les, modifiez-les ou ignorez-les.",
      href: "/calendrier",
    });
  }
  if (settings.notifyBudgetAlerts) {
    for (const { budget, evaluation } of budgets) {
      const name = input.categoryName(budget.categoryId);
      if (evaluation.level === "exceeded") {
        alerts.push({ level: "danger", title: `Budget dépassé : ${name}`, detail: `${evaluation.consumedPct} % consommé.`, href: "/budget" });
      } else if (evaluation.level === "warning") {
        alerts.push({ level: "warning", title: `Budget bientôt atteint : ${name}`, detail: `${evaluation.consumedPct} % consommé.`, href: "/budget" });
      }
    }
  }
  if (settings.notifyUpcomingBills) {
    const soon = events.filter(
      (e) => e.source !== "budget" && e.deltaCents < 0 && !e.overdue && e.date <= addDays(today, settings.billReminderDays),
    );
    if (soon.length > 0) {
      alerts.push({
        level: "info",
        title: `${soon.length} échéance(s) dans les ${settings.billReminderDays} prochains jours`,
        detail: soon.map((e) => e.label).slice(0, 4).join(", "),
        href: "/calendrier",
      });
    }
  }
  for (const a of accounts) {
    if (a.archivedAt || a.type !== "meal_voucher" || !a.validUntil) continue;
    const balance = balances.get(a.id) ?? 0;
    if (balance > 0 && a.validUntil >= today && diffDays(today, a.validUntil) <= VOUCHER_EXPIRY_WARNING_DAYS) {
      alerts.push({
        level: "warning",
        title: "Tickets-restaurant bientôt expirés",
        detail: `${a.name} : validité jusqu'au ${formatDate(a.validUntil)}.`,
        href: `/comptes/${a.id}`,
      });
    }
  }
  for (const over of overAllocatedAccounts(activeGoals, input.allocations, balances)) {
    const name = accountsById.get(over.accountId)?.name ?? "un compte";
    alerts.push({
      level: "warning",
      title: "Objectifs supérieurs au solde",
      detail: `Les objectifs liés à ${name} dépassent son solde réel.`,
      href: "/objectifs",
    });
  }

  return {
    today,
    hasAccounts,
    balances,
    totals,
    allocatedToGoalsCents,
    month,
    nextIncome: income,
    reservedUntil,
    reservedCents,
    reservedEvents,
    remainingUntilIncomeCents,
    daysUntilIncome,
    perDayCents,
    upcomingBills,
    upcomingIncomes,
    overdue,
    lowPoint,
    budgets,
    history,
    transfers,
    alerts,
  };
}
