/**
 * Chemin de l'argent d'une dépense (pour une dépense récurrente : calculé sur
 * sa première échéance, puis répété à chaque échéance par des virements
 * récurrents rattachés, voir saveTransactionAction).
 *
 * Organisation visée : un compte courant « principal » paie les dépenses
 * courantes ; un compte courant « secondaire » porte les prélèvements (loyer,
 * assurances, énergie…) ; l'épargne complète au besoin.
 *
 * Chaque compte est projeté (scénario garanti) jusqu'à 31 jours après la
 * dépense, dépense et échéances comprises. Si le compte qui paie suffit, aucun
 * virement. Sinon, le manque est couvert dans cet ordre :
 *  1. par le courant secondaire, s'il a assez tout en gardant de quoi payer
 *     ses propres prélèvements sur la période : secondaire → principal ;
 *  2. sinon, en complément, par l'épargne (livrets, puis épargne dédiée), sans
 *     jamais la rendre négative, en passant par le secondaire :
 *     épargne → secondaire → principal.
 * Le secondaire est l'autre compte courant, celui où arrivent les salaires
 * (compte d'une échéance de revenu active) ; à défaut celui de la même banque
 * qu'un livret (champ « Banque »), sinon le premier. Sans autre compte courant,
 * le virement depuis l'épargne est direct.
 * Dates : virement final la veille de la dépense, étape précédente l'avant-veille,
 * jamais avant aujourd'hui. Le chemin est une proposition : chaque étape se modifie.
 */
import type { Cents } from "@/lib/money";
import { addDays, maxDate, type IsoDate } from "@/lib/dates";
import { accountClass } from "./accounts";
import { includeEvent, type ForecastEvent } from "./forecast";
import { projectAccounts } from "./transfers";
import type { Account, RecurringRule } from "./types";

export const PATH_LOOKAHEAD_DAYS = 31;
const ROUNDING_CENTS = 1_000; // virements arrondis à 10 € supérieurs quand c'est possible

export type PathStep = { fromAccountId: string; toAccountId: string; amountCents: Cents; date: IsoDate };

export type PathProposal = {
  steps: PathStep[];
  /** Ce qui manquerait sur le compte payeur sans virement. */
  shortfallCents: Cents;
  /** Part du manque qu'aucune source ne peut couvrir. */
  uncoveredCents: Cents;
};

const sameBank = (a: Account, b: Account) =>
  !!a.institution && !!b.institution && a.institution.trim().toLowerCase() === b.institution.trim().toLowerCase();

export function proposeMoneyPath(args: {
  today: IsoDate;
  accounts: Account[];
  balances: Map<string, Cents>;
  events: ForecastEvent[];
  /** Échéances récurrentes : le compte qui reçoit les salaires est le secondaire. */
  rules: RecurringRule[];
  withBudgets: boolean;
  payerAccountId: string;
  amountCents: Cents;
  date: IsoDate;
}): PathProposal {
  const { today, payerAccountId, amountCents } = args;
  const date = maxDate(today, args.date);
  const end = addDays(date, PATH_LOOKAHEAD_DAYS);
  const active = args.accounts.filter((a) => !a.archivedAt);
  const payer = active.find((a) => a.id === payerAccountId);
  if (!payer) return { steps: [], shortfallCents: 0, uncoveredCents: 0 };

  const others = active.filter((a) => a.id !== payer.id);
  const savings = others.filter((a) => accountClass(a.type) === "savings");
  const checkings = others.filter((a) => a.type === "checking");
  const salaryAccounts = new Set(args.rules.filter((r) => r.isActive && r.kind === "income").map((r) => r.accountId));
  const secondary =
    checkings.find((c) => salaryAccounts.has(c.id)) ?? checkings.find((c) => savings.some((s) => sameBank(c, s))) ?? checkings[0] ?? null;

  const expense: ForecastEvent = {
    date,
    originalDate: date,
    overdue: false,
    deltaCents: -amountCents,
    grossCents: amountCents,
    label: "Dépense envisagée",
    kind: "expense",
    source: "planned",
    certainty: "certain",
    categoryId: null,
    ruleId: null,
    transactionId: null,
    accountDeltas: [{ accountId: payer.id, amountCents: -amountCents }],
  };
  const ids = [payer.id, ...(secondary ? [secondary.id] : []), ...savings.map((a) => a.id)];
  const projections = projectAccounts(args.balances, ids, [...args.events, expense], today, end, (e) =>
    includeEvent(e, "guaranteed", args.withBudgets),
  );
  const minOver = (id: string, from: IsoDate) =>
    Math.min(...projections.get(id)!.points.filter((p) => p.date >= from).map((p) => p.balanceCents));

  const shortfall = Math.max(0, -minOver(payer.id, date));
  if (shortfall === 0) return { steps: [], shortfallCents: 0, uncoveredCents: 0 };

  // Ce que chaque source peut donner sans passer en négatif d'ici la fin de la période
  // (le secondaire garde donc de quoi payer ses prélèvements).
  const surplus = (a: Account) => Math.max(0, minOver(a.id, today));
  const sources = [
    ...(secondary ? [{ account: secondary, surplus: surplus(secondary) }] : []),
    ...savings
      .map((a) => ({ account: a, surplus: surplus(a) }))
      .sort((x, y) => (x.account.type === y.account.type ? y.surplus - x.surplus : x.account.type === "savings" ? -1 : 1)),
  ];

  const totalSurplus = sources.reduce((s, o) => s + o.surplus, 0);
  const rounded = Math.ceil(shortfall / ROUNDING_CENTS) * ROUNDING_CENTS;
  let remaining = totalSurplus >= rounded ? rounded : Math.min(shortfall, totalSurplus);
  const taken: { account: Account; cents: Cents }[] = [];
  for (const o of sources) {
    if (remaining <= 0) break;
    const cents = Math.min(o.surplus, remaining);
    if (cents <= 0) continue;
    taken.push({ account: o.account, cents });
    remaining -= cents;
  }
  const covered = taken.reduce((s, t) => s + t.cents, 0);

  const lastHop = maxDate(today, addDays(date, -1));
  const firstHop = maxDate(today, addDays(date, -2));
  const savingsSteps: PathStep[] = [];
  const intoPayer = new Map<string, Cents>();
  for (const { account, cents } of taken) {
    if (account.id !== secondary?.id && secondary) {
      savingsSteps.push({ fromAccountId: account.id, toAccountId: secondary.id, amountCents: cents, date: firstHop });
    }
    const from = secondary ?? account;
    intoPayer.set(from.id, (intoPayer.get(from.id) ?? 0) + cents);
  }
  const finalSteps: PathStep[] = [...intoPayer.entries()].map(([fromAccountId, cents]) => ({
    fromAccountId,
    toAccountId: payer.id,
    amountCents: cents,
    date: lastHop,
  }));

  return { steps: [...savingsSteps, ...finalSteps], shortfallCents: shortfall, uncoveredCents: Math.max(0, shortfall - covered) };
}
