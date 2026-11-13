/**
 * Indicateurs du tableau de bord (docs/REGLES-COMPTABLES.md) :
 *
 *  - Total possédé : somme des soldes de tous les comptes actifs (dettes déduites).
 *  - Épargne       : livrets et épargne spécifique (Livret A, Livret Jeune…).
 *  - Dépenses par domaine : dépenses effectuées du mois en cours, par catégorie.
 *  - Salaires      : montant reçu ce mois-ci pour chaque ligne de salaire.
 */
import type { Cents } from "@/lib/money";
import { monthKeyOf, type IsoDate } from "@/lib/dates";
import { balancesAt, totalsByClass } from "./accounts";
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

export type DashboardData = {
  totalCents: Cents;
  savingsCents: Cents;
  /** Dépenses effectuées du mois, par catégorie ("" = sans catégorie), triées par montant décroissant. */
  expenses: { categoryId: string; cents: Cents }[];
  expenseTotalCents: Cents;
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

  const byCategory = new Map<string, Cents>();
  for (const t of thisMonth) {
    if (t.kind !== "expense") continue;
    const key = t.categoryId ?? "";
    byCategory.set(key, (byCategory.get(key) ?? 0) + t.amountCents);
  }
  const expenses = [...byCategory.entries()].map(([categoryId, cents]) => ({ categoryId, cents })).sort((a, b) => b.cents - a.cents);

  const salaries = Object.fromEntries(
    SALARIES.map((s) => [s.key, thisMonth.filter((t) => t.kind === "income" && t.label === s.label).reduce((sum, t) => sum + t.amountCents, 0)]),
  ) as Record<SalaryKey, Cents>;

  return {
    // Tout ce qui est possédé : chaque classe de compte, dettes déduites.
    totalCents: totals.netWorthCents + totals.voucherCents,
    savingsCents: totals.savingsCents,
    expenses,
    expenseTotalCents: expenses.reduce((s, e) => s + e.cents, 0),
    salaries,
  };
}
