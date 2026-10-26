/**
 * Objectifs d'épargne.
 *
 * Un objectif est une AFFECTATION d'argent déjà présent sur les comptes :
 * son montant accumulé n'est jamais ajouté aux soldes ni à l'épargne totale.
 *  - suivi « compte » : accumulé = solde du compte associé (borné à 0) ;
 *  - suivi « manuel » : accumulé = somme des affectations enregistrées.
 */
import type { Cents } from "@/lib/money";
import { addMonths, diffMonths, type IsoDate } from "@/lib/dates";
import type { GoalAllocation, SavingsGoal } from "./types";

export const PRIORITY_LABELS: Record<1 | 2 | 3, string> = {
  1: "Haute",
  2: "Normale",
  3: "Basse",
};

export function goalAccumulated(
  goal: Pick<SavingsGoal, "id" | "tracking" | "accountId">,
  allocations: GoalAllocation[],
  balances: Map<string, Cents>,
): Cents {
  if (goal.tracking === "account" && goal.accountId) {
    return Math.max(0, balances.get(goal.accountId) ?? 0);
  }
  let total = 0;
  for (const a of allocations) if (a.goalId === goal.id) total += a.amountCents;
  return Math.max(0, total);
}

export type GoalProgress = {
  accumulatedCents: Cents;
  remainingCents: Cents;
  pct: number; // peut dépasser 100
  achieved: boolean;
  /** Nombre de contributions mensuelles possibles d'ici la date cible. */
  monthsLeft: number | null;
  neededPerMonthCents: Cents | null;
  estimatedDate: IsoDate | null;
  targetPassed: boolean;
  onTrack: boolean | null;
};

export function goalProgress(args: {
  targetCents: Cents;
  accumulatedCents: Cents;
  targetDate: IsoDate | null;
  monthlyContributionCents: Cents | null;
  today: IsoDate;
}): GoalProgress {
  const { targetCents, accumulatedCents, targetDate, monthlyContributionCents, today } = args;
  const remainingCents = Math.max(0, targetCents - accumulatedCents);
  const achieved = remainingCents === 0;
  const pct = Math.round((accumulatedCents / targetCents) * 1000) / 10;

  let monthsLeft: number | null = null;
  let neededPerMonthCents: Cents | null = null;
  const targetPassed = !!targetDate && targetDate < today && !achieved;
  if (targetDate && !achieved && targetDate >= today) {
    monthsLeft = Math.max(1, diffMonths(today, targetDate));
    neededPerMonthCents = Math.ceil(remainingCents / monthsLeft);
  }

  let estimatedDate: IsoDate | null = null;
  if (achieved) estimatedDate = today;
  else if (monthlyContributionCents && monthlyContributionCents > 0) {
    estimatedDate = addMonths(today, Math.ceil(remainingCents / monthlyContributionCents));
  }

  let onTrack: boolean | null = null;
  if (achieved) onTrack = true;
  else if (neededPerMonthCents !== null && monthlyContributionCents) onTrack = monthlyContributionCents >= neededPerMonthCents;
  else if (targetPassed) onTrack = false;

  return { accumulatedCents, remainingCents, pct, achieved, monthsLeft, neededPerMonthCents, estimatedDate, targetPassed, onTrack };
}

/**
 * Affectations excédant l'argent réellement présent sur le compte associé :
 * signale un risque de double comptage.
 */
export function overAllocatedAccounts(
  goals: SavingsGoal[],
  allocations: GoalAllocation[],
  balances: Map<string, Cents>,
): { accountId: string; allocatedCents: Cents; balanceCents: Cents }[] {
  const allocatedByAccount = new Map<string, Cents>();
  for (const g of goals) {
    if (g.archivedAt || !g.accountId) continue;
    const accumulated = goalAccumulated(g, allocations, balances);
    allocatedByAccount.set(g.accountId, (allocatedByAccount.get(g.accountId) ?? 0) + accumulated);
  }
  const result: { accountId: string; allocatedCents: Cents; balanceCents: Cents }[] = [];
  for (const [accountId, allocatedCents] of allocatedByAccount) {
    const balanceCents = balances.get(accountId) ?? 0;
    if (allocatedCents > balanceCents) result.push({ accountId, allocatedCents, balanceCents });
  }
  return result;
}
