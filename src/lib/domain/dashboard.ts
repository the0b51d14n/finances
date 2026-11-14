/**
 * Indicateurs du tableau de bord (docs/REGLES-COMPTABLES.md) :
 *
 *  - Total possédé : somme des soldes de tous les comptes actifs (dettes déduites).
 *  - Épargne       : livrets et épargne spécifique (Livret A, Livret Jeune…).
 *  - Salaires      : montant reçu ce mois-ci pour chaque ligne de salaire.
 */
import { formatCents, type Cents } from "@/lib/money";
import { monthKeyOf, type IsoDate } from "@/lib/dates";
import { accountKindLabel } from "./account-kinds";
import { balancesAt, totalsByClass } from "./accounts";
import { paysViaTransfer } from "./ledger";
import type { Account, Category, Transaction } from "./types";

/** Lignes de salaire du tableau de bord : le montant saisi crédite le compte courant secondaire. */
export const SALARIES = [
  { key: "alternance", label: "Salaire alternance", categoryKey: "salary_apprentice" },
  { key: "auchan", label: "Salaire Auchan", categoryKey: "salary_student_job" },
] as const;

export type SalaryKey = (typeof SALARIES)[number]["key"];

const active = (accounts: Account[]) => accounts.filter((a) => !a.archivedAt);

/** Compte qui reçoit les salaires : le compte courant secondaire, sinon le premier compte courant. */
export function salaryAccount(accounts: Account[]): Account | null {
  const list = active(accounts);
  return list.find((a) => a.subtype === "secondary") ?? list.find((a) => a.type === "checking") ?? null;
}

/** Compte proposé par défaut pour une dépense : le compte courant principal. */
export function defaultExpenseAccount(accounts: Account[]): Account | null {
  const list = active(accounts);
  return list.find((a) => a.subtype === "current") ?? list.find((a) => a.type === "checking") ?? list[0] ?? null;
}

/** Catégorie de revenu associée à une ligne de salaire (catégorie par défaut). */
export function salaryCategory(key: SalaryKey, categories: Category[]): Category | null {
  const categoryKey = SALARIES.find((s) => s.key === key)!.categoryKey;
  return categories.find((c) => c.kind === "income" && c.systemKey === categoryKey && !c.archivedAt) ?? null;
}

/** Compte proposé dans une liste : regroupé par banque, avec sa nature et son solde. */
export type AccountChoice = { id: string; name: string; label: string; group: string; viaTransfer: boolean };

/**
 * Comptes actifs (hors dettes) tels qu'affichés dans les listes de choix :
 * « BZB · Carte cadeau · 20,00 € », regroupés par banque. La nature n'est
 * répétée que si elle diffère du nom (« Livret A · 3 000,00 € »).
 */
export function accountChoices(input: { accounts: Account[]; transactions: Transaction[]; today: IsoDate }): AccountChoice[] {
  const list = active(input.accounts).filter((a) => a.type !== "debt");
  const balances = balancesAt(list, input.transactions, input.today);
  return list
    .map((a) => {
      const kind = accountKindLabel(a);
      const parts = [a.name, ...(kind.toLowerCase() === a.name.toLowerCase() ? [] : [kind]), formatCents(balances.get(a.id) ?? 0)];
      return { id: a.id, name: a.name, label: parts.join(" · "), group: a.institution ?? "Sans banque", viaTransfer: paysViaTransfer(a.type) };
    })
    .sort((x, y) => (x.group === "Sans banque" ? 1 : 0) - (y.group === "Sans banque" ? 1 : 0) || x.group.localeCompare(y.group, "fr"));
}

/**
 * Choix proposés par le formulaire de dépense : domaines, comptes qui paient
 * (ni dette, ni livret, ni placement), compte par défaut, et autres moyens de
 * paiement (livrets compris : leur part passe par un virement).
 */
export function expenseFormOptions(input: { accounts: Account[]; categories: Category[]; transactions: Transaction[]; today: IsoDate }) {
  const choices = accountChoices(input);
  const payers = choices.filter((c) => !c.viaTransfer);
  const preferred = defaultExpenseAccount(input.accounts);
  return {
    categories: input.categories.filter((c) => c.kind === "expense" && !c.archivedAt).map((c) => ({ id: c.id, name: c.name })),
    accounts: payers,
    defaultAccountId: (payers.find((p) => p.id === preferred?.id) ?? payers[0])?.id ?? "",
    paymentAccounts: choices,
  };
}

export type DashboardData = {
  totalCents: Cents;
  savingsCents: Cents;
  /** Montant reçu ce mois-ci pour chaque salaire. */
  salaries: Record<SalaryKey, Cents>;
};

export function computeDashboard(input: { today: IsoDate; accounts: Account[]; transactions: Transaction[] }): DashboardData {
  const { today, transactions } = input;
  const accounts = active(input.accounts);
  const balances = balancesAt(accounts, transactions, today);
  const totals = totalsByClass(accounts, balances);
  const month = monthKeyOf(today);
  const thisMonth = transactions.filter((t) => t.status === "confirmed" && monthKeyOf(t.date) === month && t.date <= today);

  const salaries = Object.fromEntries(
    SALARIES.map((s) => [s.key, thisMonth.filter((t) => t.kind === "income" && t.label === s.label).reduce((sum, t) => sum + t.amountCents, 0)]),
  ) as Record<SalaryKey, Cents>;

  return {
    // Tout ce qui est possédé : chaque classe de compte, dettes déduites.
    totalCents: totals.netWorthCents + totals.voucherCents,
    savingsCents: totals.savingsCents,
    salaries,
  };
}
