/**
 * Récurrences : dates des échéances et enregistrement automatique.
 *
 * Une échéance tombe exactement à sa date, week-end et jours fériés compris
 * (aucun report au jour ouvré suivant). Le jour de la première échéance fixe
 * les suivantes : même jour de la semaine, même numéro du jour dans le mois
 * (borné à la fin du mois : le 31 devient le 30 ou le 28), même date chaque année.
 *
 * Aucune confirmation : une échéance (ou une opération à venir) est enregistrée
 * comme effectuée dès que sa date est atteinte.
 */
import { addDays, addMonths, isoWeekday, makeDate, parts, type IsoDate } from "@/lib/dates";
import type { Frequency, RecurringRule, Transaction } from "./types";

const STEP_DAYS: Partial<Record<Frequency, number>> = { daily: 1, weekly: 7, biweekly: 14 };
const STEP_MONTHS: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/** Échéances d'une règle comprises entre from et to (inclus), dans l'ordre. */
export function occurrences(rule: Pick<RecurringRule, "frequency" | "startDate" | "endDate">, from: IsoDate, to: IsoDate): IsoDate[] {
  const last = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const out: IsoDate[] = [];
  const days = STEP_DAYS[rule.frequency];
  const months = STEP_MONTHS[rule.frequency];
  const anchorDay = parts(rule.startDate).day;
  for (let i = 0; ; i++) {
    const date = days ? addDays(rule.startDate, i * days) : addMonths(rule.startDate, i * (months ?? 1), anchorDay);
    if (date > last) break;
    if (date >= from) out.push(date);
    if (i > 5000) break; // garde-fou (≈ 14 ans d'échéances quotidiennes)
  }
  return out;
}

/** Quand : une seule fois, ou répété (le jour demandé dépend de la fréquence). */
export type Schedule =
  | { repeat: "none"; date: IsoDate }
  | { repeat: "weekly"; weekday: number }
  | { repeat: "monthly"; day: number }
  | { repeat: "annual"; date: IsoDate };

/**
 * Première échéance d'une saisie récurrente, à partir d'aujourd'hui :
 *  - chaque semaine : prochain jour de la semaine choisi (aujourd'hui compris) ;
 *  - chaque mois : prochain jour du mois choisi (borné à la fin du mois) ;
 *  - chaque année : prochaine date anniversaire de la date choisie (aujourd'hui compris) ;
 *  - une fois : la date choisie, passée ou future.
 */
export function firstDate(schedule: Schedule, today: IsoDate): IsoDate {
  switch (schedule.repeat) {
    case "none":
      return schedule.date;
    case "annual": {
      const anchor = parts(schedule.date).day;
      let date = schedule.date;
      for (let years = 1; date < today; years++) date = addMonths(schedule.date, 12 * years, anchor);
      return date;
    }
    case "weekly":
      return addDays(today, (schedule.weekday - isoWeekday(today) + 7) % 7);
    case "monthly": {
      const { year, month } = parts(today);
      const thisMonth = addMonths(makeDate(year, month, 1), 0, schedule.day);
      return thisMonth >= today ? thisMonth : addMonths(makeDate(year, month, 1), 1, schedule.day);
    }
  }
}

export type DueRealization =
  | { type: "confirm"; transactionId: string }
  | { type: "create"; payload: Record<string, unknown> };

/**
 * Ce qui est échu et pas encore enregistré :
 *  - opérations à venir dont la date est atteinte → effectuées ;
 *  - échéances des dépenses et virements récurrents jusqu'à aujourd'hui → créées,
 *    une seule fois par échéance (une échéance supprimée reste annulée).
 * Les revenus récurrents ne sont pas enregistrés : les salaires se saisissent à la main.
 */
export function dueRealizations(input: { today: IsoDate; rules: RecurringRule[]; transactions: Transaction[] }): DueRealization[] {
  const { today } = input;
  const due: DueRealization[] = [];
  for (const t of input.transactions) {
    if (t.status === "planned" && t.date <= today) due.push({ type: "confirm", transactionId: t.id });
  }
  const recorded = new Set(input.transactions.filter((t) => t.recurrenceId).map((t) => `${t.recurrenceId}|${t.occurrenceDate}`));
  for (const rule of input.rules) {
    if (!rule.isActive || rule.kind === "income") continue;
    const from = rule.trackingStart > rule.startDate ? rule.trackingStart : rule.startDate;
    for (const date of occurrences(rule, from, today)) {
      if (recorded.has(`${rule.id}|${date}`)) continue;
      due.push({ type: "create", payload: rulePayload(rule, date) });
    }
  }
  return due;
}

/** Opération effectuée correspondant à une échéance de la règle. */
export function rulePayload(rule: RecurringRule, date: IsoDate): Record<string, unknown> {
  const entries =
    rule.kind === "transfer"
      ? [
          { account_id: rule.accountId, amount_cents: -rule.amountCents },
          { account_id: rule.toAccountId, amount_cents: rule.amountCents },
        ]
      : [{ account_id: rule.accountId, amount_cents: rule.kind === "expense" ? -rule.amountCents : rule.amountCents }];
  return {
    kind: rule.kind,
    status: "confirmed",
    date,
    label: rule.label,
    amount_cents: rule.amountCents,
    category_id: rule.kind === "transfer" ? null : rule.categoryId,
    recurrence_id: rule.id,
    occurrence_date: date,
    entries,
  };
}
