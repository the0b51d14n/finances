/**
 * Planification d'une liste d'achats (ex. équiper un logement non meublé).
 *
 * Les achats sont traités par ordre de priorité (puis date limite, puis date
 * « pas avant », puis ordre de saisie). Chacun est placé à la PREMIÈRE date où,
 * en tenant compte de tous les achats déjà placés, le solde disponible
 * (comptes courants, scénario garanti, enveloppes budgétaires si activées)
 * reste au-dessus de la réserve de sécurité :
 *   - sur les 62 jours suivant l'achat (même règle que le simulateur),
 *   - et jusqu'à la fin des fenêtres des achats déjà placés, pour qu'un nouvel
 *     achat ne compromette jamais un achat précédent.
 * Un achat placé après sa date limite est signalé « en retard », avec la somme
 * qui manquerait à la date limite. Les achats sont cumulés : la même marge
 * n'est jamais comptée deux fois.
 */
import type { Cents } from "@/lib/money";
import { addDays, maxDate, type IsoDate } from "@/lib/dates";
import { includeEvent, projectDaily, type DailyPoint, type ForecastEvent } from "./forecast";
import { SIMULATION_WINDOW_DAYS } from "./simulator";

export type PlanItem = {
  id: string;
  name: string;
  priceCents: Cents;
  priority: 1 | 2 | 3;
  /** Pas avant cette date (date souhaitée). */
  notBefore: IsoDate | null;
  deadline: IsoDate | null;
  accountId: string | null;
  categoryId: string | null;
  order: number;
};

export type PlanStatus = "scheduled" | "late" | "unschedulable";

export type PlanEntry = {
  item: PlanItem;
  date: IsoDate | null;
  status: PlanStatus;
  /** Disponible juste après l'achat (fin de journée), achats précédents compris. */
  availableAfterCents: Cents | null;
  /** Total des achats placés jusqu'à celui-ci (inclus), dans l'ordre chronologique. */
  cumulativeCents: Cents;
  /** Somme qui manquerait pour pouvoir acheter à la date limite. */
  deadlineShortfallCents: Cents | null;
};

export type PurchasePlanResult = {
  entries: PlanEntry[]; // triés par date d'achat (non planifiables à la fin)
  purchaseEvents: ForecastEvent[];
  totalCents: Cents;
  scheduledCents: Cents;
  points: DailyPoint[]; // projection garantie avec tous les achats placés
};

export function compareItems(a: PlanItem, b: PlanItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.deadline !== b.deadline) return !a.deadline ? 1 : !b.deadline ? -1 : a.deadline < b.deadline ? -1 : 1;
  if (a.notBefore !== b.notBefore) return !a.notBefore ? -1 : !b.notBefore ? 1 : a.notBefore < b.notBefore ? -1 : 1;
  return a.order - b.order;
}

export function purchaseEvent(item: PlanItem, date: IsoDate): ForecastEvent {
  return {
    date,
    originalDate: date,
    overdue: false,
    deltaCents: -item.priceCents,
    grossCents: item.priceCents,
    label: `Achat : ${item.name}`,
    kind: "expense",
    source: "planned",
    certainty: "certain",
    categoryId: item.categoryId,
    ruleId: null,
    transactionId: null,
    accountDeltas: item.accountId ? [{ accountId: item.accountId, amountCents: -item.priceCents }] : [],
  };
}

export function planPurchases(args: {
  today: IsoDate;
  horizonEnd: IsoDate;
  availableNowCents: Cents;
  events: ForecastEvent[];
  reserveCents: Cents;
  preserveBudgets: boolean;
  items: PlanItem[];
}): PurchasePlanResult {
  const { today, horizonEnd, reserveCents } = args;
  const lastStart = addDays(horizonEnd, -SIMULATION_WINDOW_DAYS);
  const placed: ForecastEvent[] = [];
  let protectedUntil: IsoDate | null = null; // fin de la plus longue fenêtre déjà engagée

  const project = () =>
    projectDaily(args.availableNowCents, [...args.events, ...placed], today, horizonEnd, (e) =>
      includeEvent(e, "guaranteed", args.preserveBudgets),
    );

  const minFrom = (points: DailyPoint[], start: IsoDate, end: IsoDate): Cents | null => {
    let min: Cents | null = null;
    for (const p of points) {
      if (p.date < start) continue;
      if (p.date > end) break;
      if (min === null || p.balanceCents < min) min = p.balanceCents;
    }
    return min;
  };

  const results: PlanEntry[] = [];
  for (const item of [...args.items].sort(compareItems)) {
    const points = project();
    const windowEnd = (d: IsoDate) => {
      const own = addDays(d, SIMULATION_WINDOW_DAYS);
      return protectedUntil && protectedUntil > own ? protectedUntil : own;
    };
    const fits = (d: IsoDate) => {
      const min = minFrom(points, d, windowEnd(d));
      return min !== null && min - item.priceCents >= reserveCents;
    };

    const start = maxDate(today, item.notBefore ?? today);
    let date: IsoDate | null = null;
    for (let d = start; d <= lastStart; d = addDays(d, 1)) {
      if (fits(d)) {
        date = d;
        break;
      }
    }

    let deadlineShortfallCents: Cents | null = null;
    if (item.deadline && (!date || date > item.deadline)) {
      const at = maxDate(start, item.deadline);
      const min = at <= horizonEnd ? minFrom(points, at, windowEnd(at)) : null;
      deadlineShortfallCents = min === null ? null : Math.max(0, reserveCents - (min - item.priceCents));
    }

    if (date) {
      placed.push(purchaseEvent(item, date));
      const end = addDays(date, SIMULATION_WINDOW_DAYS);
      if (!protectedUntil || end > protectedUntil) protectedUntil = end;
    }
    results.push({
      item,
      date,
      status: !date ? "unschedulable" : item.deadline && date > item.deadline ? "late" : "scheduled",
      availableAfterCents: null,
      cumulativeCents: 0,
      deadlineShortfallCents,
    });
  }

  // Valeurs finales : solde après chaque achat et cumul, avec tous les achats placés.
  const finalPoints = project();
  const byDate = new Map(finalPoints.map((p) => [p.date, p.balanceCents]));
  const ordered = results
    .filter((r) => r.date)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : compareItems(a.item, b.item)));
  let cumulative = 0;
  for (const r of ordered) {
    cumulative += r.item.priceCents;
    r.cumulativeCents = cumulative;
    r.availableAfterCents = byDate.get(r.date!) ?? null;
  }
  const unscheduled = results.filter((r) => !r.date);

  return {
    entries: [...ordered, ...unscheduled],
    purchaseEvents: placed,
    totalCents: args.items.reduce((s, i) => s + i.priceCents, 0),
    scheduledCents: cumulative,
    points: finalPoints,
  };
}
