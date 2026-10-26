/**
 * Virements conseillés entre comptes disponibles.
 *
 * Chaque compte courant est projeté séparément sur la fenêtre à venir
 * (scénario garanti). Si un compte passerait à découvert (ex. le compte de
 * dépenses Boursorama après un achat), on propose un virement depuis le compte
 * disponible qui garde le plus de marge sur la même fenêtre (ex. le compte
 * courant Caisse d'Épargne), sans jamais rendre ce dernier négatif : les
 * charges obligatoires qu'il porte restent couvertes.
 * Les livrets ne sont jamais proposés comme source.
 */
import type { Cents } from "@/lib/money";
import { addDays, maxDate, type IsoDate } from "@/lib/dates";
import { accountClass } from "./accounts";
import { includeEvent, type ForecastEvent } from "./forecast";
import type { Account } from "./types";

export const TRANSFER_LOOKAHEAD_DAYS = 31;
const ROUNDING_CENTS = 1_000; // montants arrondis à 10 € supérieurs quand c'est possible

export type AccountProjection = { accountId: string; points: { date: IsoDate; balanceCents: Cents }[] };

/** Solde de fin de journée de chaque compte demandé, jour par jour. */
export function projectAccounts(
  startBalances: Map<string, Cents>,
  accountIds: string[],
  events: ForecastEvent[],
  today: IsoDate,
  end: IsoDate,
  filter: (e: ForecastEvent) => boolean,
): Map<string, AccountProjection> {
  const deltas = new Map<string, Map<IsoDate, Cents>>(accountIds.map((id) => [id, new Map()]));
  for (const e of events) {
    if (!filter(e) || e.date < today || e.date > end) continue;
    for (const d of e.accountDeltas) {
      const byDate = deltas.get(d.accountId);
      if (byDate) byDate.set(e.date, (byDate.get(e.date) ?? 0) + d.amountCents);
    }
  }
  const result = new Map<string, AccountProjection>();
  for (const id of accountIds) {
    const byDate = deltas.get(id)!;
    let balance = startBalances.get(id) ?? 0;
    const points: AccountProjection["points"] = [];
    for (let d = today; d <= end; d = addDays(d, 1)) {
      balance += byDate.get(d) ?? 0;
      points.push({ date: d, balanceCents: balance });
    }
    result.set(id, { accountId: id, points });
  }
  return result;
}

export type TransferSuggestion = {
  fromAccountId: string | null;
  toAccountId: string;
  amountCents: Cents;
  /** Date à laquelle le virement doit être fait au plus tard. */
  byDate: IsoDate;
  /** Premier jour où le compte destinataire passerait à découvert. */
  shortfallDate: IsoDate;
  shortfallCents: Cents;
  /** Faux si aucun compte disponible ne peut couvrir le manque sans découvert. */
  covered: boolean;
};

export function suggestTransfers(args: {
  today: IsoDate;
  accounts: Account[];
  balances: Map<string, Cents>;
  events: ForecastEvent[];
  withBudgets: boolean;
  lookaheadDays?: number;
}): TransferSuggestion[] {
  const { today, withBudgets } = args;
  const end = addDays(today, args.lookaheadDays ?? TRANSFER_LOOKAHEAD_DAYS);
  // Avec un seul compte disponible, un découvert à venir est signalé sans source (fromAccountId nul).
  const available = args.accounts.filter((a) => !a.archivedAt && accountClass(a.type) === "available");
  const projections = projectAccounts(
    args.balances,
    available.map((a) => a.id),
    args.events,
    today,
    end,
    (e) => includeEvent(e, "guaranteed", withBudgets),
  );

  const stats = available.map((a) => {
    const points = projections.get(a.id)!.points;
    let min = Infinity;
    let firstNegative: IsoDate | null = null;
    for (const p of points) {
      if (p.balanceCents < min) min = p.balanceCents;
      if (p.balanceCents < 0 && !firstNegative) firstNegative = p.date;
    }
    return { account: a, min: points.length ? min : 0, firstNegative };
  });
  const surplus = new Map(stats.map((s) => [s.account.id, Math.max(0, s.min)]));

  const suggestions: TransferSuggestion[] = [];
  for (const s of stats.filter((x) => x.firstNegative).sort((a, b) => (a.firstNegative! < b.firstNegative! ? -1 : 1))) {
    const shortfall = -s.min;
    const source = [...surplus.entries()]
      .filter(([id]) => id !== s.account.id)
      .sort((a, b) => b[1] - a[1])[0];
    const sourceSurplus = source?.[1] ?? 0;
    const rounded = Math.ceil(shortfall / ROUNDING_CENTS) * ROUNDING_CENTS;
    const amount = sourceSurplus >= rounded ? rounded : shortfall;
    const covered = !!source && sourceSurplus >= amount;
    if (source) surplus.set(source[0], Math.max(0, sourceSurplus - amount));
    suggestions.push({
      fromAccountId: source ? source[0] : null,
      toAccountId: s.account.id,
      amountCents: amount,
      byDate: maxDate(today, addDays(s.firstNegative!, -1)),
      shortfallDate: s.firstNegative!,
      shortfallCents: shortfall,
      covered,
    });
  }
  return suggestions;
}
