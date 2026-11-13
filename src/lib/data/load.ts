import "server-only";
import { cache } from "react";
import type { Account, Category, RecurringRule, Transaction, UserSettings } from "@/lib/domain/types";
import { todayParis } from "@/lib/dates";
import { sql, updateWhere } from "@/lib/db/sql";
import type { DbError, UserDb } from "@/lib/db/user-db";
import { depletedSingleUseAccounts } from "@/lib/domain/accounts";
import { dueRealizations, type DueRealization } from "@/lib/domain/recurrence";
import { toAccount, toCategory, toRule, toSettings, toTransaction } from "./mappers";
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
};

/**
 * Charge l'ensemble des données de l'utilisateur pour la requête en cours.
 * Les calculs (soldes, totaux, dépenses par domaine) sont ensuite faits par les
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

  const today = todayParis();
  let data = toFinanceData(res.data, today, email);

  // Aucune confirmation : ce qui est échu (opérations à venir, échéances des
  // dépenses et virements récurrents) est enregistré comme effectué, puis relu.
  const due = dueRealizations(data);
  if (due.length > 0) {
    await realize(db, due);
    res = await db.batch(DATA_QUERIES);
    if (res.error) throw loadError(res.error, "données");
    data = toFinanceData(res.data, today, email);
  }

  // Carte cadeau, avoir ou bon d'achat épuisé : retiré automatiquement (archivé,
  // les dépenses payées avec restent dans l'historique). Non rechargeable.
  const depleted = depletedSingleUseAccounts(data.accounts, data.transactions, today);
  if (depleted.length > 0) {
    const archivedAt = new Date().toISOString();
    const { error } = await db.execAll(depleted.map((id) => updateWhere("accounts", { archived_at: archivedAt }, "id", id)));
    if (error) console.error(`[données] retrait des moyens de paiement épuisés : échec (${error.code ?? "?"})`);
    else data = { ...data, accounts: data.accounts.map((a) => (depleted.includes(a.id) ? { ...a, archivedAt } : a)) };
  }
  return data;
});

function toFinanceData(rows: Record<string, unknown>[][], today: string, email: string | null): FinanceData {
  const [[settings], accounts, categories, transactions, rules] = rows;
  return {
    today,
    email,
    settings: toSettings(settings),
    accounts: accounts.map(toAccount),
    categories: categories.map(toCategory),
    transactions: transactions.map(toTransaction),
    rules: rules.map(toRule),
  };
}

const realizationQuery = (d: DueRealization) =>
  d.type === "confirm"
    ? sql`select public.set_transaction_status(${d.transactionId}::uuid, 'confirmed', null)`
    : sql`select public.save_transaction(${d.payload}::jsonb)`;

/**
 * Enregistre les éléments échus en une transaction. En cas d'échec (par
 * exemple une échéance déjà enregistrée par une requête simultanée), chaque
 * élément est retenté seul : un élément en erreur ne bloque pas les autres.
 */
async function realize(db: UserDb, due: DueRealization[]): Promise<void> {
  const all = await db.execAll(due.map(realizationQuery));
  if (!all.error) return;
  let failed = 0;
  for (const d of due) {
    const one = await db.exec(realizationQuery(d));
    if (one.error) failed++;
  }
  if (failed > 0) console.error(`[données] enregistrement automatique : ${failed} élément(s) non enregistré(s)`);
}
