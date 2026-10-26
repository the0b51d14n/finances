/**
 * Simulateur d'achat : aide à la décision budgétaire (pas une garantie).
 *
 * Un achat de prix P à la date D est « compatible » si, dans le scénario
 * garanti (revenus certains seulement, toutes les sorties, enveloppes
 * budgétaires si l'option est active), le solde disponible reste au-dessus de
 * la réserve de sécurité chaque jour de [D, D + fenêtre de contrôle].
 * La fenêtre (62 jours ≈ deux cycles de revenus mensuels) garantit que les
 * prochaines factures restent couvertes sans pénaliser un achat par une
 * tendance lointaine incertaine.
 *
 * Verdicts :
 *  - compatible      : critère ci-dessus respecté ;
 *  - reduced_margin  : possible, mais entame la réserve de sécurité, ou ne
 *                      tient que grâce à des revenus estimés (probables) ;
 *  - postpone        : solde insuffisant prévu → première date compatible
 *                      proposée si elle existe dans l'horizon de prévision ;
 *  - insufficient_data : aucun compte disponible, date trop lointaine, ou
 *                      aucun revenu certain programmé pour dater l'achat.
 */
import type { Cents } from "@/lib/money";
import { addDays, maxDate, type IsoDate } from "@/lib/dates";
import { includeEvent, minBalance, projectDaily, type DailyPoint, type ForecastEvent } from "./forecast";

export const SIMULATION_WINDOW_DAYS = 62;
export const BILLS_LOOKAHEAD_DAYS = 30;

export type PurchaseVerdict = "compatible" | "reduced_margin" | "postpone" | "insufficient_data";

export const VERDICT_LABELS: Record<PurchaseVerdict, string> = {
  compatible: "Achat compatible avec le budget prévu",
  reduced_margin: "Achat possible mais réduisant la marge de sécurité",
  postpone: "Achat à reporter",
  insufficient_data: "Prévision impossible à établir avec les données actuelles",
};

export type GoalForSimulation = {
  id: string;
  name: string;
  monthlyContributionCents: Cents | null;
  accumulatedCents: Cents;
  targetCents: Cents;
};

export type SimulationInput = {
  today: IsoDate;
  horizonEnd: IsoDate;
  priceCents: Cents;
  desiredDate: IsoDate | null;
  availableNowCents: Cents;
  hasAvailableAccounts: boolean;
  events: ForecastEvent[];
  reserveCents: Cents;
  preserveBudgets: boolean;
  goals: GoalForSimulation[];
  linkedGoalId: string | null;
};

export type BillCheck = {
  date: IsoDate;
  label: string;
  amountCents: Cents;
  balanceAfterCents: Cents;
  covered: boolean;
};

export type GoalImpact = {
  goalId: string;
  name: string;
  /** Nombre de mois de contribution équivalents au prix de l'achat. */
  equivalentMonths: number | null;
  linked: boolean;
  /** Part du prix déjà couverte par l'objectif associé. */
  coveragePct: number | null;
};

export type SimulationResult = {
  verdict: PurchaseVerdict;
  reasons: string[];
  priceCents: Cents;
  purchaseDate: IsoDate;
  availableBeforeCents: Cents | null;
  availableAfterCents: Cents | null;
  minBalanceAfter: { date: IsoDate; balanceCents: Cents } | null;
  marginCents: Cents | null;
  reserveCents: Cents;
  reserveKept: boolean;
  budgetsCompromised: boolean;
  dependsOnEstimatedIncome: boolean;
  baselineBelowReserve: boolean;
  earliestDate: IsoDate | null;
  bills: BillCheck[];
  goalImpacts: GoalImpact[];
};

function windowMin(points: DailyPoint[], from: IsoDate): Cents | null {
  return minBalance(points, from, addDays(from, SIMULATION_WINDOW_DAYS))?.balanceCents ?? null;
}

export function simulatePurchase(input: SimulationInput): SimulationResult {
  const { today, horizonEnd, priceCents, reserveCents, events, preserveBudgets } = input;
  const purchaseDate = maxDate(input.desiredDate ?? today, today);
  const lastStart = addDays(horizonEnd, -SIMULATION_WINDOW_DAYS);

  const empty: SimulationResult = {
    verdict: "insufficient_data",
    reasons: [],
    priceCents,
    purchaseDate,
    availableBeforeCents: null,
    availableAfterCents: null,
    minBalanceAfter: null,
    marginCents: null,
    reserveCents,
    reserveKept: false,
    budgetsCompromised: false,
    dependsOnEstimatedIncome: false,
    baselineBelowReserve: false,
    earliestDate: null,
    bills: [],
    goalImpacts: [],
  };

  if (!input.hasAvailableAccounts) {
    return { ...empty, reasons: ["Aucun compte courant ou espèces n'est enregistré : le disponible est inconnu."] };
  }
  if (purchaseDate > lastStart) {
    return { ...empty, reasons: ["La date souhaitée dépasse l'horizon de prévision fiable (12 mois)."] };
  }

  const project = (scenario: "guaranteed" | "estimated", withBudgets: boolean) =>
    projectDaily(input.availableNowCents, events, today, horizonEnd, (e) => includeEvent(e, scenario, withBudgets));

  const guaranteed = project("guaranteed", preserveBudgets);
  const guaranteedNoBudgets = project("guaranteed", false);
  const estimated = project("estimated", preserveBudgets);

  const feasible = (points: DailyPoint[], date: IsoDate, floor: Cents) => {
    const min = windowMin(points, date);
    return min !== null && min - priceCents >= floor;
  };

  const okGuaranteed = feasible(guaranteed, purchaseDate, reserveCents);
  const okGuaranteedNoReserve = feasible(guaranteed, purchaseDate, 0);
  const okEstimated = feasible(estimated, purchaseDate, reserveCents);
  const okNoBudgets = feasible(guaranteedNoBudgets, purchaseDate, reserveCents);

  const before = guaranteed.find((p) => p.date === purchaseDate)?.balanceCents ?? null;
  const minBefore = minBalance(guaranteed, purchaseDate, addDays(purchaseDate, SIMULATION_WINDOW_DAYS));
  const minAfter = minBefore ? { date: minBefore.date, balanceCents: minBefore.balanceCents - priceCents } : null;
  const baselineBelowReserve = !!minBefore && minBefore.balanceCents < reserveCents;
  const budgetsCompromised = preserveBudgets && !okGuaranteed && okNoBudgets;

  const reasons: string[] = [];
  let verdict: PurchaseVerdict;
  let dependsOnEstimatedIncome = false;

  if (okGuaranteed) {
    verdict = "compatible";
  } else if (okGuaranteedNoReserve || okEstimated) {
    verdict = "reduced_margin";
    if (okGuaranteedNoReserve) reasons.push("La réserve de sécurité serait entamée pendant la période de contrôle.");
    if (!okGuaranteedNoReserve && okEstimated) {
      dependsOnEstimatedIncome = true;
      reasons.push("L'achat ne tient que grâce à des revenus estimés, non garantis.");
    }
  } else {
    verdict = "postpone";
    reasons.push("Le solde disponible deviendrait insuffisant avant les prochaines rentrées d'argent.");
  }
  if (budgetsCompromised) reasons.push("L'achat empiéterait sur vos enveloppes budgétaires (courses, etc.).");
  if (baselineBelowReserve) reasons.push("Même sans cet achat, votre solde prévu passe sous la réserve de sécurité.");

  let earliestDate: IsoDate | null = okGuaranteed ? purchaseDate : null;
  if (!okGuaranteed) {
    for (let d = addDays(purchaseDate, 1); d <= lastStart; d = addDays(d, 1)) {
      if (feasible(guaranteed, d, reserveCents)) {
        earliestDate = d;
        break;
      }
    }
  }

  if (verdict === "postpone" && !earliestDate) {
    const hasCertainIncome = events.some((e) => e.kind === "income" && e.deltaCents > 0 && e.certainty === "certain");
    if (!hasCertainIncome) {
      verdict = "insufficient_data";
      reasons.push("Aucun revenu certain n'est programmé : impossible d'estimer quand l'achat deviendra possible.");
    } else {
      reasons.push("Aucune date compatible n'a été trouvée dans les 12 prochains mois avec les données actuelles.");
    }
  }

  const bills: BillCheck[] = events
    .filter(
      (e) =>
        e.source !== "budget" &&
        e.deltaCents < 0 &&
        e.date >= purchaseDate &&
        e.date <= addDays(purchaseDate, BILLS_LOOKAHEAD_DAYS),
    )
    .map((e) => {
      const balance = (guaranteed.find((p) => p.date === e.date)?.balanceCents ?? 0) - priceCents;
      return { date: e.date, label: e.label, amountCents: -e.deltaCents, balanceAfterCents: balance, covered: balance >= 0 };
    });
  if (bills.some((b) => !b.covered)) reasons.push("Certaines échéances des 30 prochains jours ne seraient plus couvertes.");

  const goalImpacts: GoalImpact[] = input.goals.map((g) => {
    const linked = g.id === input.linkedGoalId;
    return {
      goalId: g.id,
      name: g.name,
      linked,
      equivalentMonths:
        g.monthlyContributionCents && g.monthlyContributionCents > 0
          ? Math.ceil(priceCents / g.monthlyContributionCents)
          : null,
      coveragePct: linked ? Math.min(100, Math.round((g.accumulatedCents / priceCents) * 1000) / 10) : null,
    };
  });

  return {
    verdict,
    reasons,
    priceCents,
    purchaseDate,
    availableBeforeCents: before,
    availableAfterCents: before === null ? null : before - priceCents,
    minBalanceAfter: minAfter,
    marginCents: minAfter ? minAfter.balanceCents - reserveCents : null,
    reserveCents,
    reserveKept: okGuaranteed,
    budgetsCompromised,
    dependsOnEstimatedIncome,
    baselineBelowReserve,
    earliestDate,
    bills,
    goalImpacts,
  };
}
