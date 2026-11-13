/**
 * Calendrier : chaque dépense, virement et revenu du mois à sa date.
 *
 *  - opérations enregistrées (effectuées ou à venir), hors annulées et ajustements ;
 *  - échéances futures des dépenses et virements récurrents, pas encore
 *    enregistrées (elles le seront seules à leur date).
 * Aucune date n'est décalée : un samedi reste un samedi.
 */
import type { Cents } from "@/lib/money";
import { endOfMonth, isoWeekday, parts, startOfMonth, type IsoDate, type MonthKey } from "@/lib/dates";
import { occurrences } from "./recurrence";
import type { RecurringRule, Transaction } from "./types";

const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Rythme d'une règle en clair : « Chaque mardi », « Chaque mois le 5 », « Chaque année le 1er mars ». */
export function ruleScheduleText(rule: Pick<RecurringRule, "frequency" | "startDate">): string {
  const { day, month } = parts(rule.startDate);
  const dayText = day === 1 ? "1er" : String(day);
  switch (rule.frequency) {
    case "daily":
      return "Chaque jour";
    case "weekly":
      return `Chaque ${WEEKDAYS[isoWeekday(rule.startDate) - 1]}`;
    case "biweekly":
      return `Un ${WEEKDAYS[isoWeekday(rule.startDate) - 1]} sur deux`;
    case "monthly":
      return `Chaque mois le ${dayText}`;
    case "quarterly":
      return `Chaque trimestre le ${dayText}`;
    case "semiannual":
      return `Chaque semestre le ${dayText}`;
    case "annual":
      return `Chaque année le ${dayText} ${MONTHS[month - 1]}`;
  }
}

export type CalendarItem = {
  key: string;
  date: IsoDate;
  kind: "expense" | "income" | "transfer";
  label: string;
  amountCents: Cents;
  categoryId: string | null;
  /** Comptes concernés : payeur (ou crédité), et destinataire d'un virement. */
  accountId: string;
  toAccountId: string | null;
  /** Opération enregistrée (supprimable) ou échéance future d'une règle. */
  transactionId: string | null;
  /** Règle récurrente d'origine (arrêtable), le cas échéant. */
  ruleId: string | null;
  upcoming: boolean;
};

export function calendarItems(input: { month: MonthKey; today: IsoDate; transactions: Transaction[]; rules: RecurringRule[] }): CalendarItem[] {
  const { month, today } = input;
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const items: CalendarItem[] = [];

  for (const t of input.transactions) {
    if (t.status === "cancelled" || t.kind === "adjustment" || t.date < from || t.date > to) continue;
    const out = t.entries.find((e) => e.amountCents < 0);
    const inc = t.entries.find((e) => e.amountCents > 0);
    items.push({
      key: t.id,
      date: t.date,
      kind: t.kind,
      label: t.label,
      amountCents: t.amountCents,
      categoryId: t.categoryId,
      accountId: (t.kind === "income" ? inc : out)?.accountId ?? t.entries[0]?.accountId ?? "",
      toAccountId: t.kind === "transfer" ? (inc?.accountId ?? null) : null,
      transactionId: t.id,
      ruleId: t.recurrenceId,
      upcoming: t.status === "planned",
    });
  }

  const recorded = new Set(input.transactions.filter((t) => t.recurrenceId).map((t) => `${t.recurrenceId}|${t.occurrenceDate}`));
  for (const rule of input.rules) {
    if (!rule.isActive || rule.kind === "income") continue;
    const start = [from, rule.trackingStart, rule.startDate].reduce((a, b) => (a > b ? a : b));
    for (const date of occurrences(rule, start, to)) {
      if (date <= today || recorded.has(`${rule.id}|${date}`)) continue;
      items.push({
        key: `${rule.id}|${date}`,
        date,
        kind: rule.kind,
        label: rule.label,
        amountCents: rule.amountCents,
        categoryId: rule.categoryId,
        accountId: rule.accountId,
        toAccountId: rule.toAccountId,
        transactionId: null,
        ruleId: rule.id,
        upcoming: true,
      });
    }
  }

  const order = { income: 0, transfer: 1, expense: 2 };
  return items.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || b.amountCents - a.amountCents);
}
