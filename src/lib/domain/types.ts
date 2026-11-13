/**
 * Types métier partagés par les calculs, l'accès aux données et l'interface.
 * Ils reflètent le schéma SQL (db/migrations) en camelCase.
 */
import type { Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { AccountSubtype } from "./account-kinds";

export type AccountType =
  | "checking"
  | "cash"
  | "savings"
  | "dedicated_savings"
  | "other"
  | "meal_voucher"
  | "investment"
  | "debt"
  | "earmarked";

/**
 * Classe comptable d'un compte, déterminée par son type :
 *  - available  : argent librement disponible (compte courant, espèces)
 *  - savings    : épargne (livrets, épargne spécifique)
 *  - reserve    : autre réserve, comptée dans le total mais pas dans le disponible
 *  - investment : placements à valeur fluctuante, comptés dans le total
 *  - debt       : crédits et dettes (solde ≤ 0), jamais comptés comme de l'argent
 *  - voucher    : tickets-restaurant et avantages affectés, hors total
 */
export type AccountClass = "available" | "savings" | "reserve" | "investment" | "debt" | "voucher";

export type TransactionKind = "expense" | "income" | "transfer" | "adjustment";
export type TransactionStatus = "planned" | "confirmed" | "cancelled";
export type CategoryKind = "expense" | "income";

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  /** Nature précise (Livret A, PEA…) ; null pour un compte antérieur aux natures. */
  subtype: AccountSubtype | null;
  currency: string;
  openingBalanceCents: Cents;
  openingBalanceDate: IsoDate;
  validUntil: IsoDate | null;
  institution: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  /** Jours (1 = lundi … 7 = dimanche) où la banque ne traite pas les opérations. */
  closedWeekdays: number[];
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

/** Fréquences proposées à la saisie (la base en accepte d'autres, lues sans erreur). */
export type Frequency = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "annual";

/** Dépense ou virement qui se répète ; chaque échéance est enregistrée seule à sa date. */
export type RecurringRule = {
  id: string;
  kind: "expense" | "income" | "transfer";
  label: string;
  amountCents: Cents;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  frequency: Frequency;
  /** Première échéance : son jour (de semaine, du mois, de l'année) fixe les suivantes. */
  startDate: IsoDate;
  endDate: IsoDate | null;
  /** Les échéances antérieures ne sont jamais enregistrées. */
  trackingStart: IsoDate;
  isActive: boolean;
};

export type UserSettings = {
  theme: "dark" | "light" | "system";
};

export const DEFAULT_SETTINGS: UserSettings = { theme: "dark" };
