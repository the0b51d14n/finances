import { raw, sql } from "@/lib/db/sql";
import { ACCOUNT_COLUMNS, CATEGORY_COLUMNS, SETTINGS_COLUMNS, TRANSACTION_COLUMNS } from "./mappers";

/** Opérations avec leurs écritures, agrégées en une passe (pas de requête par opération). */
const TRANSACTIONS_QUERY = sql`
  select ${raw(TRANSACTION_COLUMNS)}, coalesce(e.entries, '[]'::json) as entries
    from public.transactions t
    left join (
      select transaction_id,
             json_agg(json_build_object('account_id', account_id, 'amount_cents', amount_cents) order by created_at, id) as entries
        from public.entries
       group by transaction_id
    ) e on e.transaction_id = t.id
   order by t.date desc, t.created_at desc, t.id`;

/**
 * Lectures de loadFinanceData, exécutées ensemble dans une seule transaction
 * (un aller-retour). Ordre : paramètres, comptes, catégories, opérations.
 */
export const DATA_QUERIES = [
  sql`select ${raw(SETTINGS_COLUMNS)} from public.user_settings`,
  sql`select ${raw(ACCOUNT_COLUMNS)} from public.accounts order by created_at, id`,
  sql`select ${raw(CATEGORY_COLUMNS)} from public.categories order by kind, sort_order, name`,
  TRANSACTIONS_QUERY,
];
