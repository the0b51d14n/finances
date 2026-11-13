/**
 * Conversion des lignes SQL (snake_case) en types métier (camelCase).
 * Les colonnes sélectionnées sont centralisées ici pour rester cohérentes.
 */
import type { Account, Category, RecurringRule, Transaction, UserSettings } from "@/lib/domain/types";

export const ACCOUNT_COLUMNS =
  "id, name, type, subtype, currency, opening_balance_cents, opening_balance_date, valid_until, institution, notes, archived_at, created_at, closed_weekdays";
export const CATEGORY_COLUMNS = "id, kind, name, system_key, color, sort_order, archived_at";
/** Colonnes de public.transactions (alias t) ; les écritures sont jointes à part (voir load.ts). */
export const TRANSACTION_COLUMNS =
  "t.id, t.kind, t.status, t.date, t.label, t.notes, t.amount_cents, t.expected_amount_cents, t.category_id, t.recurrence_id, t.occurrence_date, t.is_exceptional, t.created_at, t.updated_at, t.confirmed_at";
export const RULE_COLUMNS =
  "id, kind, label, amount_cents, account_id, to_account_id, category_id, frequency, start_date, end_date, tracking_start, is_active";
export const SETTINGS_COLUMNS = "theme";

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
    subtype: strOrNull(r.subtype) as Account["subtype"],
    currency: str(r.currency),
    openingBalanceCents: num(r.opening_balance_cents),
    openingBalanceDate: str(r.opening_balance_date),
    validUntil: strOrNull(r.valid_until),
    institution: strOrNull(r.institution),
    notes: strOrNull(r.notes),
    archivedAt: strOrNull(r.archived_at),
    createdAt: str(r.created_at),
    closedWeekdays: Array.isArray(r.closed_weekdays) ? r.closed_weekdays.map(Number) : [],
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
    isActive: Boolean(r.is_active),
  };
}

export function toSettings(r: Row): UserSettings {
  return { theme: r.theme as UserSettings["theme"] };
}
