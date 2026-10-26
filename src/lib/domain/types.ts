/**
 * Types métier partagés par les calculs, l'accès aux données et l'interface.
 * Ils reflètent le schéma SQL (supabase/migrations) en camelCase.
 */
import type { Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

export type AccountType = "checking" | "cash" | "savings" | "dedicated_savings" | "other" | "meal_voucher";

/**
 * Classe comptable d'un compte, déterminée par son type :
 *  - available : argent librement disponible (compte courant, espèces)
 *  - savings   : épargne (livrets, épargne spécifique)
 *  - reserve   : autre réserve, comptée dans le total mais pas dans le disponible
 *  - voucher   : tickets-restaurant, ressource affectée, hors total bancaire
 */
export type AccountClass = "available" | "savings" | "reserve" | "voucher";

export type TransactionKind = "expense" | "income" | "transfer" | "adjustment";
export type TransactionStatus = "planned" | "confirmed" | "cancelled";
export type CategoryKind = "expense" | "income";
export type Frequency = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "annual";
export type Certainty = "certain" | "probable" | "uncertain";
export type BudgetPeriod = "weekly" | "monthly";
export type Priority = 1 | 2 | 3;

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceCents: Cents;
  openingBalanceDate: IsoDate;
  validUntil: IsoDate | null;
  institution: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type Category = {
  id: string;
  kind: CategoryKind;
  name: string;
  systemKey: string | null;
  color: string | null;
  sortOrder: number;
  archivedAt: string | null;
};

export type Entry = {
  accountId: string;
  amountCents: Cents; // signé : négatif = sortie du compte
};

export type Transaction = {
  id: string;
  kind: TransactionKind;
  status: TransactionStatus;
  date: IsoDate;
  label: string;
  notes: string | null;
  amountCents: Cents; // toujours positif
  expectedAmountCents: Cents | null;
  categoryId: string | null;
  recurrenceId: string | null;
  occurrenceDate: IsoDate | null;
  isExceptional: boolean;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  entries: Entry[];
};

export type RecurringRule = {
  id: string;
  kind: "expense" | "income" | "transfer";
  label: string;
  amountCents: Cents;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  frequency: Frequency;
  startDate: IsoDate;
  endDate: IsoDate | null;
  trackingStart: IsoDate;
  certainty: Certainty;
  isActive: boolean;
  notes: string | null;
};

export type Budget = {
  id: string;
  categoryId: string;
  period: BudgetPeriod;
  amountCents: Cents;
  alertPct: number | null;
  isActive: boolean;
};

export type SavingsGoal = {
  id: string;
  name: string;
  targetCents: Cents;
  targetDate: IsoDate | null;
  monthlyContributionCents: Cents | null;
  priority: Priority;
  tracking: "manual" | "account";
  accountId: string | null;
  achievedAt: string | null;
  archivedAt: string | null;
  notes: string | null;
};

export type GoalAllocation = {
  id: string;
  goalId: string;
  date: IsoDate;
  amountCents: Cents;
  note: string | null;
};

export type PurchasePlan = {
  id: string;
  name: string;
  priceCents: Cents;
  desiredDate: IsoDate | null;
  priority: Priority;
  url: string | null;
  notes: string | null;
  goalId: string | null;
  status: "active" | "purchased" | "abandoned";
  /** Date limite : l'achat doit être fait au plus tard ce jour-là. */
  deadline: IsoDate | null;
  /** Projet regroupant plusieurs achats (ex. « Emménagement »). */
  project: string | null;
  /** Compte qui paiera l'achat (par défaut : compte de dépenses courantes). */
  accountId: string | null;
  categoryId: string | null;
};

export type UserSettings = {
  currency: string;
  theme: "dark" | "light" | "system";
  safetyReserveCents: Cents;
  budgetAlertPct: number;
  billReminderDays: number;
  comparisonMonths: number;
  forecastIncludeProbable: boolean;
  preserveBudgetsInForecast: boolean;
  notifyBudgetAlerts: boolean;
  notifyUpcomingBills: boolean;
  notifyLowBalance: boolean;
  /** Compte de dépenses courantes (achats, enveloppes budgétaires, virements conseillés). */
  spendingAccountId: string | null;
};

export const DEFAULT_SETTINGS: UserSettings = {
  currency: "EUR",
  theme: "dark",
  safetyReserveCents: 0,
  budgetAlertPct: 80,
  billReminderDays: 7,
  comparisonMonths: 6,
  forecastIncludeProbable: false,
  preserveBudgetsInForecast: true,
  notifyBudgetAlerts: true,
  notifyUpcomingBills: true,
  notifyLowBalance: true,
  spendingAccountId: null,
};
