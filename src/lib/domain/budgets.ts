/**
 * Budgets par catégorie.
 *
 * Périodes calendaires : semaine du lundi au dimanche, mois calendaire.
 * « Dépensé » = somme des dépenses CONFIRMÉES de la catégorie dans la période
 * (montant total de l'opération, y compris une éventuelle part payée en
 * tickets-restaurant). Chaque opération appartient à une seule catégorie et
 * une seule période : elle n'est jamais comptée deux fois.
 * « Prévu » = opérations prévues + échéances récurrentes non réalisées de la
 * catégorie dans la période, affiché séparément.
 */
import type { Cents } from "@/lib/money";
import { addDays, diffDays, endOfMonth, endOfWeek, monthKeyOf, startOfMonth, startOfWeek, type IsoDate } from "@/lib/dates";
import type { BudgetPeriod, Transaction } from "./types";

export const BUDGET_PERIOD_LABELS: Record<BudgetPeriod, string> = {
  weekly: "Hebdomadaire",
  monthly: "Mensuel",
};

export type DateRange = { start: IsoDate; end: IsoDate };

export function budgetPeriodRange(period: BudgetPeriod, date: IsoDate): DateRange {
  if (period === "weekly") return { start: startOfWeek(date), end: endOfWeek(date) };
  const key = monthKeyOf(date);
  return { start: startOfMonth(key), end: endOfMonth(key) };
}

export function previousPeriodRange(period: BudgetPeriod, date: IsoDate): DateRange {
  const current = budgetPeriodRange(period, date);
  return budgetPeriodRange(period, addDays(current.start, -1));
}

export function inRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

/** Dépenses confirmées d'une catégorie sur une période. */
export function spentInRange(transactions: Transaction[], categoryId: string, range: DateRange): Cents {
  let total = 0;
  for (const tx of transactions) {
    if (tx.kind === "expense" && tx.status === "confirmed" && tx.categoryId === categoryId && inRange(tx.date, range)) {
      total += tx.amountCents;
    }
  }
  return total;
}

export type BudgetLevel = "ok" | "warning" | "exceeded";

export type BudgetEvaluation = {
  amountCents: Cents;
  spentCents: Cents;
  plannedCents: Cents;
  remainingCents: Cents; // peut être négatif en cas de dépassement
  consumedPct: number;
  /** Projection fin de période : max(constaté + prévu, rythme actuel extrapolé). */
  projectionCents: Cents;
  elapsedDays: number;
  totalDays: number;
  level: BudgetLevel;
  projectedOverrun: boolean;
};

export function evaluateBudget(args: {
  amountCents: Cents;
  alertPct: number;
  spentCents: Cents;
  plannedCents: Cents;
  range: DateRange;
  today: IsoDate;
}): BudgetEvaluation {
  const { amountCents, alertPct, spentCents, plannedCents, range, today } = args;
  const totalDays = diffDays(range.start, range.end) + 1;
  let elapsedDays: number;
  if (today < range.start) elapsedDays = 0;
  else if (today > range.end) elapsedDays = totalDays;
  else elapsedDays = diffDays(range.start, today) + 1;

  const linear = elapsedDays > 0 ? Math.round((spentCents * totalDays) / elapsedDays) : spentCents;
  const projectionCents = Math.max(spentCents + plannedCents, today > range.end ? spentCents : linear);
  const consumedPct = Math.round((spentCents / amountCents) * 1000) / 10;

  let level: BudgetLevel = "ok";
  if (spentCents > amountCents) level = "exceeded";
  else if (spentCents * 100 >= amountCents * alertPct) level = "warning";

  return {
    amountCents,
    spentCents,
    plannedCents,
    remainingCents: amountCents - spentCents,
    consumedPct,
    projectionCents,
    elapsedDays,
    totalDays,
    level,
    projectedOverrun: projectionCents > amountCents,
  };
}
