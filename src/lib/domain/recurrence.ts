/**
 * Récurrences : génération des occurrences et statut de chaque échéance.
 *
 * Les occurrences ne sont jamais stockées à l'avance. Une occurrence est :
 *  - « réalisée »  : une opération confirmée lui est liée ;
 *  - « planifiée » : une opération prévue lui est liée ;
 *  - « ignorée »   : une opération annulée lui est liée (échéance sautée) ;
 *  - « à venir »   : date future, rien de lié ;
 *  - « en retard » : date passée, rien de lié → à confirmer ou ignorer ;
 *  - « hors suivi » : antérieure au début de suivi de la règle (réputée
 *    incluse dans les soldes initiaux, jamais comptée).
 * Une échéance prévue n'est jamais comptée comme effectuée avant confirmation.
 */
import type { Cents } from "@/lib/money";
import { addDays, addMonths, diffDays, diffMonths, maxDate, minDate, parts, type IsoDate } from "@/lib/dates";
import type { Frequency, RecurringRule, Transaction } from "./types";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  biweekly: "Toutes les deux semaines",
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  semiannual: "Semestrielle",
  annual: "Annuelle",
};

const STEPS: Record<Frequency, { days?: number; months?: number }> = {
  daily: { days: 1 },
  weekly: { days: 7 },
  biweekly: { days: 14 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  semiannual: { months: 6 },
  annual: { months: 12 },
};

const MAX_OCCURRENCES = 5_000;

type Schedule = Pick<RecurringRule, "frequency" | "startDate" | "endDate">;

/** Dates d'occurrence comprises dans [from, to], ancrées sur la date de début. */
export function occurrenceDates(rule: Schedule, from: IsoDate, to: IsoDate): IsoDate[] {
  const lo = maxDate(from, rule.startDate);
  const hi = rule.endDate ? minDate(to, rule.endDate) : to;
  if (lo > hi) return [];

  const step = STEPS[rule.frequency];
  const out: IsoDate[] = [];

  if (step.days) {
    const n0 = Math.max(0, Math.ceil(diffDays(rule.startDate, lo) / step.days));
    for (let n = n0; out.length < MAX_OCCURRENCES; n++) {
      const d = addDays(rule.startDate, n * step.days);
      if (d > hi) break;
      out.push(d);
    }
    return out;
  }

  const months = step.months!;
  const anchorDay = parts(rule.startDate).day;
  const n0 = Math.max(0, Math.floor(diffMonths(rule.startDate, lo) / months) - 1);
  for (let n = n0; out.length < MAX_OCCURRENCES; n++) {
    const d = addMonths(rule.startDate, n * months, anchorDay);
    if (d > hi) break;
    if (d >= lo) out.push(d);
  }
  return out;
}

export function nextOccurrence(rule: Schedule, onOrAfter: IsoDate, horizonDays = 800): IsoDate | null {
  return occurrenceDates(rule, onOrAfter, addDays(onOrAfter, horizonDays))[0] ?? null;
}

export function occurrenceKey(ruleId: string, date: IsoDate): string {
  return `${ruleId}|${date}`;
}

/** Index des opérations liées à une occurrence de récurrence. */
export function realizationIndex(transactions: Transaction[]): Map<string, Transaction> {
  const index = new Map<string, Transaction>();
  for (const tx of transactions) {
    if (tx.recurrenceId && tx.occurrenceDate) index.set(occurrenceKey(tx.recurrenceId, tx.occurrenceDate), tx);
  }
  return index;
}

export type OccurrenceStatus = "realized" | "planned" | "skipped" | "pending" | "overdue" | "untracked";

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  realized: "Réalisée",
  planned: "Planifiée",
  skipped: "Ignorée",
  pending: "À venir",
  overdue: "À confirmer",
  untracked: "Hors suivi",
};

export type Occurrence = {
  rule: RecurringRule;
  date: IsoDate; // date prévue
  status: OccurrenceStatus;
  transaction: Transaction | null;
};

export function listOccurrences(
  rule: RecurringRule,
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
  index: Map<string, Transaction>,
): Occurrence[] {
  const result: Occurrence[] = [];
  for (const date of occurrenceDates(rule, from, to)) {
    const tx = index.get(occurrenceKey(rule.id, date)) ?? null;
    if (tx) {
      const status: OccurrenceStatus =
        tx.status === "confirmed" ? "realized" : tx.status === "planned" ? "planned" : "skipped";
      result.push({ rule, date, status, transaction: tx });
      continue;
    }
    // Une règle désactivée ne produit plus d'échéances attendues.
    if (!rule.isActive) continue;
    if (date < rule.trackingStart) {
      result.push({ rule, date, status: "untracked", transaction: null });
    } else {
      result.push({ rule, date, status: date < today ? "overdue" : "pending", transaction: null });
    }
  }
  return result;
}

/** Montant mensuel équivalent, pour comparer des charges de périodicités différentes. */
export function monthlyEquivalentCents(amountCents: Cents, frequency: Frequency): Cents {
  switch (frequency) {
    case "daily":
      return Math.round((amountCents * 365) / 12);
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "biweekly":
      return Math.round((amountCents * 26) / 12);
    case "monthly":
      return amountCents;
    case "quarterly":
      return Math.round(amountCents / 3);
    case "semiannual":
      return Math.round(amountCents / 6);
    case "annual":
      return Math.round(amountCents / 12);
  }
}
