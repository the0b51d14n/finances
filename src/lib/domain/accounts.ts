/**
 * Comptes : classes comptables et calcul des soldes.
 *
 * Règle du solde initial : opening_balance_cents est le solde au DÉBUT du
 * jour opening_balance_date. Seules les écritures confirmées datées de ce jour
 * ou après sont ajoutées. Les opérations antérieures restent visibles dans
 * l'historique et les analyses, mais n'ont aucun effet sur le solde (elles
 * sont réputées déjà incluses dans le solde initial).
 */
import type { Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { Account, AccountClass, AccountType, Transaction } from "./types";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Compte courant",
  cash: "Espèces",
  savings: "Livret d'épargne",
  dedicated_savings: "Épargne spécifique",
  other: "Autre réserve",
  meal_voucher: "Tickets-restaurant",
  investment: "Placement",
  debt: "Crédit ou dette",
  earmarked: "Avantage affecté",
};

export const ACCOUNT_CLASS_LABELS: Record<AccountClass, string> = {
  available: "Disponible",
  savings: "Épargne",
  reserve: "Réserve",
  investment: "Placements",
  debt: "Dettes",
  voucher: "Ressource affectée",
};

export function accountClass(type: AccountType): AccountClass {
  switch (type) {
    case "checking":
    case "cash":
      return "available";
    case "savings":
    case "dedicated_savings":
      return "savings";
    case "other":
      return "reserve";
    case "investment":
      return "investment";
    case "debt":
      return "debt";
    case "meal_voucher":
    case "earmarked":
      return "voucher";
  }
}

/** Les ressources affectées (tickets, cartes cadeaux…) ne peuvent faire l'objet d'aucun transfert. */
export function isTransferable(type: AccountType): boolean {
  return type !== "meal_voucher" && type !== "earmarked";
}

/** Types qu'un compte déjà utilisé ne peut ni prendre ni quitter (règles d'écritures ou de signe propres). */
export const TYPES_LOCKED_WHEN_USED: ReadonlySet<AccountType> = new Set(["meal_voucher", "earmarked", "debt"]);

/** Une écriture compte dans le solde si l'opération est confirmée et datée après le solde initial. */
export function countsInBalance(account: Account, tx: Pick<Transaction, "status" | "date">): boolean {
  return tx.status === "confirmed" && tx.date >= account.openingBalanceDate;
}

/**
 * Solde de chaque compte à la fin du jour `asOf` (inclus).
 * Un compte dont le solde initial est postérieur à `asOf` n'existe pas encore : absent du résultat.
 */
export function balancesAt(accounts: Account[], transactions: Transaction[], asOf: IsoDate): Map<string, Cents> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const result = new Map<string, Cents>();
  for (const a of accounts) {
    if (a.openingBalanceDate <= asOf) result.set(a.id, a.openingBalanceCents);
  }
  for (const tx of transactions) {
    if (tx.status !== "confirmed" || tx.date > asOf) continue;
    for (const e of tx.entries) {
      const account = byId.get(e.accountId);
      if (!account || !result.has(e.accountId)) continue;
      if (tx.date < account.openingBalanceDate) continue;
      result.set(e.accountId, (result.get(e.accountId) ?? 0) + e.amountCents);
    }
  }
  return result;
}

export type BalanceTotals = {
  /** Total des soldes : disponible + épargne + réserves + placements (hors ressources affectées et dettes). */
  totalCents: Cents;
  availableCents: Cents;
  savingsCents: Cents;
  reserveCents: Cents;
  investmentCents: Cents;
  /** Somme des dettes : négative ou nulle. */
  debtCents: Cents;
  voucherCents: Cents;
  /** Patrimoine net : total des soldes + dettes. */
  netWorthCents: Cents;
};

export function totalsByClass(accounts: Account[], balances: Map<string, Cents>): BalanceTotals {
  const totals: BalanceTotals = {
    totalCents: 0,
    availableCents: 0,
    savingsCents: 0,
    reserveCents: 0,
    investmentCents: 0,
    debtCents: 0,
    voucherCents: 0,
    netWorthCents: 0,
  };
  for (const a of accounts) {
    const b = balances.get(a.id);
    if (b === undefined) continue;
    switch (accountClass(a.type)) {
      case "available":
        totals.availableCents += b;
        break;
      case "savings":
        totals.savingsCents += b;
        break;
      case "reserve":
        totals.reserveCents += b;
        break;
      case "investment":
        totals.investmentCents += b;
        break;
      case "debt":
        totals.debtCents += b;
        break;
      case "voucher":
        totals.voucherCents += b;
        break;
    }
  }
  totals.totalCents = totals.availableCents + totals.savingsCents + totals.reserveCents + totals.investmentCents;
  totals.netWorthCents = totals.totalCents + totals.debtCents;
  return totals;
}

/** Effet d'une opération sur l'ensemble des comptes d'une classe donnée. */
export function deltaOnClass(
  entries: { accountId: string; amountCents: Cents }[],
  accountsById: Map<string, Account>,
  cls: AccountClass,
): Cents {
  let delta = 0;
  for (const e of entries) {
    const account = accountsById.get(e.accountId);
    if (account && accountClass(account.type) === cls) delta += e.amountCents;
  }
  return delta;
}
