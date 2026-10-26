/** Constructeurs de données synthétiques pour les tests unitaires. */
import type {
  Account,
  AccountType,
  Budget,
  Category,
  RecurringRule,
  Transaction,
  TransactionKind,
  TransactionStatus,
} from "@/lib/domain/types";

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function account(id: string, type: AccountType, openingCents = 0, openingDate = "2026-01-01", extra: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    type,
    currency: "EUR",
    openingBalanceCents: openingCents,
    openingBalanceDate: openingDate,
    validUntil: null,
    institution: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

export function tx(
  kind: TransactionKind,
  date: string,
  amountCents: number,
  entries: [string, number][],
  extra: Partial<Transaction> & { status?: TransactionStatus } = {},
): Transaction {
  return {
    id: nextId("tx"),
    kind,
    status: "confirmed",
    date,
    label: `${kind} ${date}`,
    notes: null,
    amountCents,
    expectedAmountCents: null,
    categoryId: kind === "expense" || kind === "income" ? "cat-default" : null,
    recurrenceId: null,
    occurrenceDate: null,
    isExceptional: false,
    createdAt: `${date}T10:00:00Z`,
    updatedAt: `${date}T10:00:00Z`,
    confirmedAt: extra.status && extra.status !== "confirmed" ? null : `${date}T10:00:00Z`,
    entries: entries.map(([accountId, amount]) => ({ accountId, amountCents: amount })),
    ...extra,
  };
}

export const expense = (date: string, cents: number, accountId: string, extra: Partial<Transaction> = {}) =>
  tx("expense", date, cents, [[accountId, -cents]], extra);

export const income = (date: string, cents: number, accountId: string, extra: Partial<Transaction> = {}) =>
  tx("income", date, cents, [[accountId, cents]], extra);

export const transfer = (date: string, cents: number, from: string, to: string, extra: Partial<Transaction> = {}) =>
  tx(
    "transfer",
    date,
    cents,
    [
      [from, -cents],
      [to, cents],
    ],
    extra,
  );

export function rule(partial: Partial<RecurringRule> & Pick<RecurringRule, "kind" | "amountCents" | "accountId" | "startDate">): RecurringRule {
  return {
    id: nextId("rule"),
    label: `Règle ${partial.kind}`,
    toAccountId: null,
    categoryId: partial.kind === "transfer" ? null : "cat-default",
    frequency: "monthly",
    endDate: null,
    trackingStart: "2026-01-01",
    certainty: "certain",
    isActive: true,
    notes: null,
    ...partial,
  };
}

export function budget(categoryId: string, period: "weekly" | "monthly", amountCents: number): Budget {
  return { id: nextId("budget"), categoryId, period, amountCents, alertPct: null, isActive: true };
}

export function category(id: string, kind: "expense" | "income", systemKey: string | null = null): Category {
  return { id, kind, name: id, systemKey, color: null, sortOrder: 0, archivedAt: null };
}

export const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));
