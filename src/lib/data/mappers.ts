/**
 * Conversion des lignes Supabase (snake_case) en types métier (camelCase).
 * Les colonnes sélectionnées sont centralisées ici pour rester cohérentes.
 */
import type {
  Account,
  Budget,
  Category,
  GoalAllocation,
  PurchasePlan,
  RecurringRule,
  SavingsGoal,
  Transaction,
  UserSettings,
} from "@/lib/domain/types";

export const ACCOUNT_COLUMNS =
  "id, name, type, currency, opening_balance_cents, opening_balance_date, valid_until, institution, notes, archived_at, created_at";
export const CATEGORY_COLUMNS = "id, kind, name, system_key, color, sort_order, archived_at";
export const TRANSACTION_COLUMNS =
  "id, kind, status, date, label, notes, amount_cents, expected_amount_cents, category_id, recurrence_id, occurrence_date, is_exceptional, created_at, updated_at, confirmed_at, entries(account_id, amount_cents)";
export const RULE_COLUMNS =
  "id, kind, label, amount_cents, account_id, to_account_id, category_id, frequency, start_date, end_date, tracking_start, certainty, is_active, notes";
export const BUDGET_COLUMNS = "id, category_id, period, amount_cents, alert_pct, is_active";
export const GOAL_COLUMNS =
  "id, name, target_cents, target_date, monthly_contribution_cents, priority, tracking, account_id, achieved_at, archived_at, notes";
export const ALLOCATION_COLUMNS = "id, goal_id, date, amount_cents, note";
export const PURCHASE_COLUMNS =
  "id, name, price_cents, desired_date, priority, url, notes, goal_id, status, deadline, project, account_id, category_id";
export const SETTINGS_COLUMNS =
  "currency, theme, safety_reserve_cents, budget_alert_pct, bill_reminder_days, comparison_months, forecast_include_probable, preserve_budgets_in_forecast, notify_budget_alerts, notify_upcoming_bills, notify_low_balance, spending_account_id";

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function toAccount(r: Row): Account {
  return {
    id: str(r.id),
    name: str(r.name),
    type: r.type as Account["type"],
    currency: str(r.currency),
    openingBalanceCents: num(r.opening_balance_cents),
    openingBalanceDate: str(r.opening_balance_date),
    validUntil: strOrNull(r.valid_until),
    institution: strOrNull(r.institution),
    notes: strOrNull(r.notes),
    archivedAt: strOrNull(r.archived_at),
    createdAt: str(r.created_at),
  };
}

export function toCategory(r: Row): Category {
  return {
    id: str(r.id),
    kind: r.kind as Category["kind"],
    name: str(r.name),
    systemKey: strOrNull(r.system_key),
    color: strOrNull(r.color),
    sortOrder: num(r.sort_order),
    archivedAt: strOrNull(r.archived_at),
  };
}

export function toTransaction(r: Row): Transaction {
  const entries = Array.isArray(r.entries) ? (r.entries as Row[]) : [];
  return {
    id: str(r.id),
    kind: r.kind as Transaction["kind"],
    status: r.status as Transaction["status"],
    date: str(r.date),
    label: str(r.label),
    notes: strOrNull(r.notes),
    amountCents: num(r.amount_cents),
    expectedAmountCents: numOrNull(r.expected_amount_cents),
    categoryId: strOrNull(r.category_id),
    recurrenceId: strOrNull(r.recurrence_id),
    occurrenceDate: strOrNull(r.occurrence_date),
    isExceptional: Boolean(r.is_exceptional),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    confirmedAt: strOrNull(r.confirmed_at),
    entries: entries.map((e) => ({ accountId: str(e.account_id), amountCents: num(e.amount_cents) })),
  };
}

export function toRule(r: Row): RecurringRule {
  return {
    id: str(r.id),
    kind: r.kind as RecurringRule["kind"],
    label: str(r.label),
    amountCents: num(r.amount_cents),
    accountId: str(r.account_id),
    toAccountId: strOrNull(r.to_account_id),
    categoryId: strOrNull(r.category_id),
    frequency: r.frequency as RecurringRule["frequency"],
    startDate: str(r.start_date),
    endDate: strOrNull(r.end_date),
    trackingStart: str(r.tracking_start),
    certainty: r.certainty as RecurringRule["certainty"],
    isActive: Boolean(r.is_active),
    notes: strOrNull(r.notes),
  };
}

export function toBudget(r: Row): Budget {
  return {
    id: str(r.id),
    categoryId: str(r.category_id),
    period: r.period as Budget["period"],
    amountCents: num(r.amount_cents),
    alertPct: numOrNull(r.alert_pct),
    isActive: Boolean(r.is_active),
  };
}

export function toGoal(r: Row): SavingsGoal {
  return {
    id: str(r.id),
    name: str(r.name),
    targetCents: num(r.target_cents),
    targetDate: strOrNull(r.target_date),
    monthlyContributionCents: numOrNull(r.monthly_contribution_cents),
    priority: num(r.priority) as SavingsGoal["priority"],
    tracking: r.tracking as SavingsGoal["tracking"],
    accountId: strOrNull(r.account_id),
    achievedAt: strOrNull(r.achieved_at),
    archivedAt: strOrNull(r.archived_at),
    notes: strOrNull(r.notes),
  };
}

export function toAllocation(r: Row): GoalAllocation {
  return {
    id: str(r.id),
    goalId: str(r.goal_id),
    date: str(r.date),
    amountCents: num(r.amount_cents),
    note: strOrNull(r.note),
  };
}

export function toPurchasePlan(r: Row): PurchasePlan {
  return {
    id: str(r.id),
    name: str(r.name),
    priceCents: num(r.price_cents),
    desiredDate: strOrNull(r.desired_date),
    priority: num(r.priority) as PurchasePlan["priority"],
    url: strOrNull(r.url),
    notes: strOrNull(r.notes),
    goalId: strOrNull(r.goal_id),
    status: r.status as PurchasePlan["status"],
    deadline: strOrNull(r.deadline),
    project: strOrNull(r.project),
    accountId: strOrNull(r.account_id),
    categoryId: strOrNull(r.category_id),
  };
}

export function toSettings(r: Row): UserSettings {
  return {
    currency: str(r.currency),
    theme: r.theme as UserSettings["theme"],
    safetyReserveCents: num(r.safety_reserve_cents),
    budgetAlertPct: num(r.budget_alert_pct),
    billReminderDays: num(r.bill_reminder_days),
    comparisonMonths: num(r.comparison_months),
    forecastIncludeProbable: Boolean(r.forecast_include_probable),
    preserveBudgetsInForecast: Boolean(r.preserve_budgets_in_forecast),
    notifyBudgetAlerts: Boolean(r.notify_budget_alerts),
    notifyUpcomingBills: Boolean(r.notify_upcoming_bills),
    notifyLowBalance: Boolean(r.notify_low_balance),
    spendingAccountId: strOrNull(r.spending_account_id),
  };
}
