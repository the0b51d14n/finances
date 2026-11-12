/**
 * Récurrences : génération des occurrences et statut de chaque échéance.
 *
 * Les occurrences ne sont jamais stockées à l'avance. Une occurrence est :
 *  - « réalisée »  : une opération confirmée lui est liée ;
 *  - « planifiée » : une opération prévue lui est liée ;
 *  - « ignorée »   : une opération annulée lui est liée (échéance sautée) ;
 *  - « à venir »   : date future, rien de lié ;
 *  - « non enregistrée » : date atteinte, rien de lié. Ne dure pas : elle est
 *    enregistrée automatiquement au chargement (voir realization.ts) ;
 *  - « hors suivi » : antérieure au début de suivi de la règle (réputée
 *    incluse dans les soldes initiaux, jamais comptée).
 * Il n'y a aucune confirmation : une échéance compte dès que sa date est atteinte.
 *
 * Jours ouvrés : une échéance qui tombe un samedi, un dimanche ou un jour férié
 * est reportée au jour ouvré suivant (date effective, `dueDate`). Sa date
 * théorique reste sa clé.
 */
import type { Cents } from "@/lib/money";
import { addDays, addMonths, diffDays, diffMonths, maxDate, minDate, nextBusinessDay, parts, type IsoDate } from "@/lib/dates";
import type { Account, Frequency, RecurringRule, Transaction } from "./types";

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
  overdue: "Non enregistrée",
  untracked: "Hors suivi",
};

export type Occurrence = {
  rule: RecurringRule;
  /** Date théorique de l'échéance : sa clé (occurrence_date), jamais décalée. */
  date: IsoDate;
  /** Date effective : un week-end, un jour férié ou un jour de fermeture de la banque passe au jour ouvré suivant. */
  dueDate: IsoDate;
  status: OccurrenceStatus;
  transaction: Transaction | null;
};

/**
 * Jours de fermeture qui s'appliquent à une règle : ceux de la banque du compte
 * débité (compte de la dépense ou du revenu, compte de départ d'un virement).
 */
export function ruleClosedWeekdays(rule: Pick<RecurringRule, "accountId">, accountsById: Map<string, Account>): number[] {
  return accountsById.get(rule.accountId)?.closedWeekdays ?? [];
}

/**
 * Prochaine date effective (jour ouvré) à partir de `onOrAfter` inclus. Une
 * échéance théorique tout juste passée mais reportée (week-end, jour férié,
 * fermeture de la banque) compte : on regarde jusqu'à 7 jours en arrière.
 */
export function nextDueDate(rule: Schedule, onOrAfter: IsoDate, closedWeekdays: readonly number[] = []): IsoDate | null {
  for (const date of occurrenceDates(rule, addDays(onOrAfter, -7), addDays(onOrAfter, 800))) {
    const due = nextBusinessDay(date, closedWeekdays);
    if (due >= onOrAfter) return due;
  }
  return null;
}

export function listOccurrences(
  rule: RecurringRule,
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
  index: Map<string, Transaction>,
  /** Jours de fermeture de la banque du compte débité (voir ruleClosedWeekdays). */
  closedWeekdays: readonly number[] = [],
): Occurrence[] {
  const result: Occurrence[] = [];
  for (const date of occurrenceDates(rule, from, to)) {
    const dueDate = nextBusinessDay(date, closedWeekdays);
    const tx = index.get(occurrenceKey(rule.id, date)) ?? null;
    if (tx) {
      const status: OccurrenceStatus =
        tx.status === "confirmed" ? "realized" : tx.status === "planned" ? "planned" : "skipped";
      result.push({ rule, date, dueDate, status, transaction: tx });
      continue;
    }
    // Une règle désactivée ne produit plus d'échéances attendues.
    if (!rule.isActive) continue;
    if (date < rule.trackingStart) {
      result.push({ rule, date, dueDate, status: "untracked", transaction: null });
    } else {
      result.push({ rule, date, dueDate, status: dueDate < today ? "overdue" : "pending", transaction: null });
    }
  }
  return result;
}

export type StopPlan = {
  /** Opérations liées à supprimer (cette échéance et les suivantes). */
  transactionIds: string[];
  /** Règles qui continuent jusqu'à la veille de la coupure. */
  endRules: { id: string; endDate: IsoDate }[];
  /** Règles sans plus aucune échéance : supprimées (virements du chemin d'abord). */
  deleteRuleIds: string[];
};

/**
 * « Supprimer celle-ci et les suivantes » : arrête la règle à partir de
 * l'échéance `from`. Ses virements du chemin de l'argent s'arrêtent aussi, à
 * partir du premier virement qui suit l'échéance précédente (celui qui
 * alimentait `from`). Les opérations déjà enregistrées pour ces échéances sont
 * supprimées ; les échéances antérieures restent intactes.
 */
export function planStopFrom(rule: RecurringRule, from: IsoDate, rules: RecurringRule[], transactions: Transaction[]): StopPlan {
  const previous = occurrenceDates(rule, rule.startDate, addDays(from, -1)).at(-1) ?? null;
  const cuts: { rule: RecurringRule; from: IsoDate }[] = [];
  for (const child of rules.filter((r) => r.fundedRuleId === rule.id)) {
    const childFrom = previous ? nextOccurrence(child, addDays(previous, 1), 3_700) : child.startDate;
    if (childFrom) cuts.push({ rule: child, from: childFrom });
  }
  cuts.push({ rule, from });

  const plan: StopPlan = { transactionIds: [], endRules: [], deleteRuleIds: [] };
  for (const cut of cuts) {
    for (const tx of transactions) {
      if (tx.recurrenceId === cut.rule.id && tx.occurrenceDate && tx.occurrenceDate >= cut.from) plan.transactionIds.push(tx.id);
    }
    if (cut.from <= cut.rule.startDate) plan.deleteRuleIds.push(cut.rule.id);
    else {
      const endDate = addDays(cut.from, -1);
      if (!cut.rule.endDate || cut.rule.endDate > endDate) plan.endRules.push({ id: cut.rule.id, endDate });
    }
  }
  return plan;
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
