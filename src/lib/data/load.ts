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
import {
  ACCOUNT_COLUMNS,
  ALLOCATION_COLUMNS,
  BUDGET_COLUMNS,
  CATEGORY_COLUMNS,
  GOAL_COLUMNS,
  PURCHASE_COLUMNS,
  RULE_COLUMNS,
  SETTINGS_COLUMNS,
  TRANSACTION_COLUMNS,
  toAccount,
  toAllocation,
  toBudget,
  toCategory,
  toGoal,
  toPurchasePlan,
  toRule,
  toSettings,
  toTransaction,
} from "./mappers";
import { getSession } from "./session";

export class DataLoadError extends Error {
  constructor(what: string, advice = "Vérifiez votre connexion puis réessayez.") {
    super(`Impossible de charger les données (${what}). ${advice}`);
    this.name = "DataLoadError";
  }
}

const MIGRATION_PENDING_ADVICE =
  "Une migration récente n'a pas été appliquée : exécutez dans l'ordre les fichiers de supabase/migrations non encore exécutés (SQL Editor), puis rechargez.";

type Page = { data: Record<string, unknown>[] | null; error: { code?: string } | null };

/** PostgREST limite chaque réponse (1000 lignes par défaut) : on pagine jusqu'au bout. */
async function fetchAll(what: string, query: (from: number, to: number) => PromiseLike<Page>): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) {
      console.error(`[données] échec du chargement : ${what} (${error.code ?? "?"})`);
      if (error.code === "42703" || error.code === "PGRST204") throw new DataLoadError("base à mettre à jour", MIGRATION_PENDING_ADVICE);
      throw new DataLoadError(what);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
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
  const { supabase, email } = await getSession();

  let settingsRes = await supabase.from("user_settings").select(SETTINGS_COLUMNS).maybeSingle();
  if (settingsRes.error?.code === "PGRST205" || settingsRes.error?.code === "42P01") {
    throw new DataLoadError(
      "base non initialisée",
      "Exécutez le fichier supabase/migrations/20261025000001_initial_schema.sql dans Supabase → SQL Editor, puis rechargez la page.",
    );
  }
  if (settingsRes.error?.code === "42703" || settingsRes.error?.code === "PGRST204") {
    throw new DataLoadError("base à mettre à jour", MIGRATION_PENDING_ADVICE);
  }
  if (!settingsRes.error && !settingsRes.data) {
    // Premier accès : création idempotente des paramètres et catégories par défaut.
    const setup = await supabase.rpc("ensure_user_setup");
    if (setup.error) throw new DataLoadError("initialisation");
    settingsRes = await supabase.from("user_settings").select(SETTINGS_COLUMNS).maybeSingle();
  }
  if (settingsRes.error || !settingsRes.data) throw new DataLoadError("paramètres");

  const [accounts, categories, transactions, rules, budgets, goals, allocations, purchasePlans] = await Promise.all([
    fetchAll("comptes", (f, t) => supabase.from("accounts").select(ACCOUNT_COLUMNS).order("created_at").order("id").range(f, t)),
    fetchAll("catégories", (f, t) =>
      supabase.from("categories").select(CATEGORY_COLUMNS).order("kind").order("sort_order").order("name").range(f, t),
    ),
    fetchAll("opérations", (f, t) =>
      supabase
        .from("transactions")
        .select(TRANSACTION_COLUMNS)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(f, t),
    ),
    fetchAll("récurrences", (f, t) => supabase.from("recurring_rules").select(RULE_COLUMNS).order("label").order("id").range(f, t)),
    fetchAll("budgets", (f, t) => supabase.from("budgets").select(BUDGET_COLUMNS).order("created_at").order("id").range(f, t)),
    fetchAll("objectifs", (f, t) => supabase.from("savings_goals").select(GOAL_COLUMNS).order("priority").order("created_at").range(f, t)),
    fetchAll("affectations", (f, t) => supabase.from("goal_allocations").select(ALLOCATION_COLUMNS).order("date").order("id").range(f, t)),
    fetchAll("achats envisagés", (f, t) => supabase.from("purchase_plans").select(PURCHASE_COLUMNS).order("created_at").order("id").range(f, t)),
  ]);

  return {
    today: todayParis(),
    email,
    settings: toSettings(settingsRes.data as Record<string, unknown>),
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
  const { supabase } = await getSession();
  const { data, error } = await supabase
    .from("transaction_audit")
    .select("id, action, changed_at, old_data")
    .eq("transaction_id", transactionId)
    .order("changed_at", { ascending: false });
  if (error) throw new DataLoadError("historique de l'opération");
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    action: r.action as AuditEntry["action"],
    changedAt: String(r.changed_at),
    oldData: r.old_data as Record<string, unknown>,
  }));
}
