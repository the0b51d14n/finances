import "server-only";
import { cache } from "react";
import type {
  Account,
  Budget,
  Category,
  GoalAllocation,
  PurchasePlan,
  RecurringRule,
  SavingsGoal,
  Transaction,
  UserSettings,
} from "@/lib/domain/types";
import { todayParis } from "@/lib/dates";
import { sql } from "@/lib/db/sql";
import type { DbError } from "@/lib/db/user-db";
import { toAccount, toAllocation, toBudget, toCategory, toGoal, toPurchasePlan, toRule, toSettings, toTransaction } from "./mappers";
import { DATA_QUERIES } from "./queries";
import { getSession } from "./session";

export class DataLoadError extends Error {
  constructor(what: string, advice = "Vérifiez votre connexion puis réessayez.") {
    super(`Impossible de charger les données (${what}). ${advice}`);
    this.name = "DataLoadError";
  }
}

const MIGRATION_PENDING_ADVICE = "Une migration récente n'a pas été appliquée : exécutez npm run db:migrate, puis rechargez.";

/** Erreur de chargement : table absente (base vide) ou colonne absente (migration en retard). */
function loadError(error: DbError, what: string): DataLoadError {
  console.error(`[données] échec du chargement : ${what} (${error.code ?? "?"})`);
  if (error.code === "42P01") return new DataLoadError("base non initialisée", "Exécutez npm run db:migrate, puis rechargez la page.");
  if (error.code === "42703") return new DataLoadError("base à mettre à jour", MIGRATION_PENDING_ADVICE);
  return new DataLoadError(what);
}

export type FinanceData = {
  today: string;
  email: string | null;
  settings: UserSettings;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  rules: RecurringRule[];
  budgets: Budget[];
  goals: SavingsGoal[];
  allocations: GoalAllocation[];
  purchasePlans: PurchasePlan[];
};

/**
 * Charge l'ensemble des données de l'utilisateur pour la requête en cours.
 * Les calculs (soldes, budgets, prévisions) sont ensuite faits par les
 * fonctions pures de src/lib/domain, à partir de l'historique réel :
 * aucun total n'est stocké, donc aucun total ne peut diverger.
 */
export const loadFinanceData = cache(async (): Promise<FinanceData> => {
  const { db, email } = await getSession();

  let res = await db.batch(DATA_QUERIES);
  if (res.error) throw loadError(res.error, "données");

  if (res.data[0].length === 0) {
    // Premier accès : création idempotente des paramètres et catégories par défaut.
    const setup = await db.exec(sql`select public.ensure_user_setup()`);
    if (setup.error) throw loadError(setup.error, "initialisation");
    res = await db.batch(DATA_QUERIES);
    if (res.error) throw loadError(res.error, "données");
    if (res.data[0].length === 0) throw new DataLoadError("paramètres");
  }

  const [[settings], accounts, categories, transactions, rules, budgets, goals, allocations, purchasePlans] = res.data;
  return {
    today: todayParis(),
    email,
    settings: toSettings(settings),
    accounts: accounts.map(toAccount),
    categories: categories.map(toCategory),
    transactions: transactions.map(toTransaction),
    rules: rules.map(toRule),
    budgets: budgets.map(toBudget),
    goals: goals.map(toGoal),
    allocations: allocations.map(toAllocation),
    purchasePlans: purchasePlans.map(toPurchasePlan),
  };
});

export type AuditEntry = { id: number; action: "update" | "status" | "delete"; changedAt: string; oldData: Record<string, unknown> };

export async function loadTransactionAudit(transactionId: string): Promise<AuditEntry[]> {
  const { db } = await getSession();
  const { data, error } = await db.rows(sql`
    select id, action, changed_at, old_data
      from public.transaction_audit
     where transaction_id = ${transactionId}
     order by changed_at desc`);
  if (error) throw new DataLoadError("historique de l'opération");
  return data.map((r) => ({
    id: Number(r.id),
    action: r.action as AuditEntry["action"],
    changedAt: String(r.changed_at),
    oldData: r.old_data as Record<string, unknown>,
  }));
}
