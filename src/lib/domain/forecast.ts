/**
 * Moteur de prévision : solde de l'argent DISPONIBLE (comptes courants +
 * espèces) jour par jour.
 *
 * Mouvements pris en compte, chacun à sa date :
 *  - échéances récurrentes non réalisées (les échéances en retard sont
 *    reportées à aujourd'hui) ;
 *  - opérations prévues (statut « prévu ») ;
 *  - enveloppes budgétaires restantes (option « préserver les budgets ») :
 *    pour chaque période, budget − déjà dépensé − déjà prévu dans la
 *    catégorie, jamais négatif, pour ne pas compter deux fois une dépense
 *    déjà programmée.
 * Seul l'effet sur l'argent disponible compte : un virement du compte courant
 * vers un livret est une sortie du disponible ; une dépense payée en
 * tickets-restaurant n'en est pas une.
 *
 * Certitude : les sorties sont toujours retenues (prudence). Les entrées
 * sont retenues selon le scénario : « garanti » = certaines uniquement,
 * « estimé » = certaines + probables. Les entrées incertaines ne sont jamais
 * comptées, seulement affichées.
 */
import type { Cents } from "@/lib/money";
import { addDays, type IsoDate } from "@/lib/dates";
import { accountClass, deltaOnClass } from "./accounts";
import { budgetPeriodRange, inRange, spentInRange, type DateRange } from "./budgets";
import { listOccurrences, realizationIndex } from "./recurrence";
import type { Account, Budget, Certainty, Entry, RecurringRule, Transaction } from "./types";

export const FORECAST_HORIZON_DAYS = 365;

export type ForecastEventSource = "recurring" | "planned" | "budget";

export type ForecastEvent = {
  date: IsoDate; // date d'effet dans la prévision
  originalDate: IsoDate;
  overdue: boolean;
  deltaCents: Cents; // effet signé sur l'argent disponible
  grossCents: Cents; // montant de l'opération (pour les budgets)
  label: string;
  kind: "income" | "expense" | "transfer";
  source: ForecastEventSource;
  certainty: Certainty;
  categoryId: string | null;
  ruleId: string | null;
  transactionId: string | null;
  /** Effet sur chaque compte (vide pour une enveloppe sans compte de dépenses). */
  accountDeltas: Entry[];
};

export type ForecastContext = {
  today: IsoDate;
  horizonEnd: IsoDate;
  accounts: Account[];
  rules: RecurringRule[];
  transactions: Transaction[];
  budgets: Budget[];
  /** Compte de dépenses courantes : les enveloppes budgétaires y sont imputées. */
  spendingAccountId?: string | null;
};

function ruleEntries(rule: RecurringRule): Entry[] {
  switch (rule.kind) {
    case "expense":
      return [{ accountId: rule.accountId, amountCents: -rule.amountCents }];
    case "income":
      return [{ accountId: rule.accountId, amountCents: rule.amountCents }];
    case "transfer":
      return [
        { accountId: rule.accountId, amountCents: -rule.amountCents },
        { accountId: rule.toAccountId!, amountCents: rule.amountCents },
      ];
  }
}

function ruleDelta(rule: RecurringRule, accountsById: Map<string, Account>): Cents {
  const from = accountsById.get(rule.accountId);
  const fromAvailable = !!from && accountClass(from.type) === "available";
  switch (rule.kind) {
    case "expense":
      return fromAvailable ? -rule.amountCents : 0;
    case "income":
      return fromAvailable ? rule.amountCents : 0;
    case "transfer": {
      const to = rule.toAccountId ? accountsById.get(rule.toAccountId) : undefined;
      const toAvailable = !!to && accountClass(to.type) === "available";
      return (fromAvailable ? -rule.amountCents : 0) + (toAvailable ? rule.amountCents : 0);
    }
  }
}

export function buildForecastEvents(ctx: ForecastContext): ForecastEvent[] {
  const { today, horizonEnd } = ctx;
  const accountsById = new Map(ctx.accounts.map((a) => [a.id, a]));
  const index = realizationIndex(ctx.transactions);
  const events: ForecastEvent[] = [];

  // 1. Échéances récurrentes non réalisées.
  for (const rule of ctx.rules) {
    if (!rule.isActive) continue;
    const delta = ruleDelta(rule, accountsById);
    for (const occ of listOccurrences(rule, rule.trackingStart, horizonEnd, today, index)) {
      if (occ.status !== "pending" && occ.status !== "overdue") continue;
      const overdue = occ.status === "overdue";
      events.push({
        date: overdue ? today : occ.date,
        originalDate: occ.date,
        overdue,
        deltaCents: delta,
        grossCents: rule.amountCents,
        label: rule.label,
        kind: rule.kind,
        source: "recurring",
        certainty: delta < 0 ? "certain" : rule.certainty,
        categoryId: rule.categoryId,
        ruleId: rule.id,
        transactionId: null,
        accountDeltas: ruleEntries(rule),
      });
    }
  }

  // 2. Opérations prévues ponctuelles (ou occurrences planifiées).
  for (const tx of ctx.transactions) {
    if (tx.status !== "planned" || tx.kind === "adjustment" || tx.date > horizonEnd) continue;
    const delta = deltaOnClass(tx.entries, accountsById, "available");
    const overdue = tx.date < today;
    // Une entrée ponctuelle prévue n'est pas garantie ; un virement interne l'est.
    const certainty: Certainty = delta > 0 && tx.kind === "income" ? "probable" : "certain";
    events.push({
      date: overdue ? today : tx.date,
      originalDate: tx.date,
      overdue,
      deltaCents: delta,
      grossCents: tx.amountCents,
      label: tx.label,
      kind: tx.kind,
      source: "planned",
      certainty,
      categoryId: tx.categoryId,
      ruleId: tx.recurrenceId,
      transactionId: tx.id,
      accountDeltas: tx.entries,
    });
  }

  // 3. Enveloppes budgétaires restantes. Si une catégorie a un budget
  //    hebdomadaire ET mensuel, seul l'hebdomadaire (plus fin) est utilisé.
  //    Les dépenses déjà programmées dans la catégorie (y compris celles
  //    payées hors du disponible) sont déduites de l'enveloppe.
  const spending = ctx.spendingAccountId ? accountsById.get(ctx.spendingAccountId) : undefined;
  const envelopeAccountId = spending && accountClass(spending.type) === "available" ? spending.id : null;
  const weeklyCategories = new Set(ctx.budgets.filter((b) => b.isActive && b.period === "weekly").map((b) => b.categoryId));
  const scheduledExpenses = events.filter((e) => e.kind === "expense" && e.categoryId);
  for (const budget of ctx.budgets) {
    if (!budget.isActive) continue;
    if (budget.period === "monthly" && weeklyCategories.has(budget.categoryId)) continue;
    let range: DateRange = budgetPeriodRange(budget.period, today);
    let first = true;
    while (range.start <= horizonEnd) {
      const scheduled = scheduledExpenses
        .filter((e) => e.categoryId === budget.categoryId && inRange(e.date, range))
        .reduce((sum, e) => sum + e.grossCents, 0);
      const spent = first ? spentInRange(ctx.transactions, budget.categoryId, range) : 0;
      const remaining = budget.amountCents - spent - scheduled;
      if (remaining > 0) {
        const date = first ? today : range.start;
        events.push({
          date,
          originalDate: date,
          overdue: false,
          deltaCents: -remaining,
          grossCents: remaining,
          label: "Enveloppe budgétaire",
          kind: "expense",
          source: "budget",
          certainty: "certain",
          categoryId: budget.categoryId,
          ruleId: null,
          transactionId: null,
          accountDeltas: envelopeAccountId ? [{ accountId: envelopeAccountId, amountCents: -remaining }] : [],
        });
      }
      range = budgetPeriodRange(budget.period, addDays(range.end, 1));
      first = false;
    }
  }

  // On conserve aussi les virements entre deux comptes disponibles (effet nul
  // sur le total, mais indispensable à la projection compte par compte).
  const touchesAvailable = (e: ForecastEvent) =>
    e.accountDeltas.some((d) => {
      const a = accountsById.get(d.accountId);
      return !!a && accountClass(a.type) === "available";
    });
  return events
    .filter((e) => e.deltaCents !== 0 || touchesAvailable(e))
    .sort((a, b) => (a.date === b.date ? a.deltaCents - b.deltaCents : a.date < b.date ? -1 : 1));
}

export type Scenario = "guaranteed" | "estimated";

export function includeEvent(e: ForecastEvent, scenario: Scenario, withBudgets: boolean): boolean {
  if (e.source === "budget" && !withBudgets) return false;
  if (e.deltaCents < 0) return true;
  if (e.certainty === "certain") return true;
  return scenario === "estimated" && e.certainty === "probable";
}

export type DailyPoint = {
  date: IsoDate;
  balanceCents: Cents; // solde en fin de journée
  inCents: Cents;
  outCents: Cents;
};

export function projectDaily(
  startCents: Cents,
  events: ForecastEvent[],
  today: IsoDate,
  end: IsoDate,
  filter: (e: ForecastEvent) => boolean,
): DailyPoint[] {
  const byDate = new Map<IsoDate, { in: Cents; out: Cents }>();
  for (const e of events) {
    if (!filter(e) || e.date < today || e.date > end) continue;
    const slot = byDate.get(e.date) ?? { in: 0, out: 0 };
    if (e.deltaCents > 0) slot.in += e.deltaCents;
    else slot.out += -e.deltaCents;
    byDate.set(e.date, slot);
  }
  const points: DailyPoint[] = [];
  let balance = startCents;
  for (let d = today; d <= end; d = addDays(d, 1)) {
    const slot = byDate.get(d);
    if (slot) balance += slot.in - slot.out;
    points.push({ date: d, balanceCents: balance, inCents: slot?.in ?? 0, outCents: slot?.out ?? 0 });
  }
  return points;
}

/** Solde minimal sur [from, to] (fin de journée). */
export function minBalance(points: DailyPoint[], from: IsoDate, to: IsoDate): { date: IsoDate; balanceCents: Cents } | null {
  let best: DailyPoint | null = null;
  for (const p of points) {
    if (p.date < from || p.date > to) continue;
    if (!best || p.balanceCents < best.balanceCents) best = p;
  }
  return best ? { date: best.date, balanceCents: best.balanceCents } : null;
}

/** Prochaine entrée d'argent retenue dans le scénario (revenu, hors virements). */
export function nextIncome(events: ForecastEvent[], scenario: Scenario, today: IsoDate): ForecastEvent | null {
  return events.find((e) => e.kind === "income" && e.deltaCents > 0 && e.date >= today && includeEvent(e, scenario, false)) ?? null;
}

/** Sorties programmées (hors enveloppes budgétaires) sur [from, untilExclusive[. */
export function scheduledOutflows(events: ForecastEvent[], from: IsoDate, untilExclusive: IsoDate): ForecastEvent[] {
  return events.filter((e) => e.source !== "budget" && e.deltaCents < 0 && e.date >= from && e.date < untilExclusive);
}
