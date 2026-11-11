"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure, safeReturnTo, success, type ActionState } from "@/lib/actions/state";
import { addDays, todayParis } from "@/lib/dates";
import { dbErrorMessage } from "@/lib/data/errors";
import { ACCOUNT_COLUMNS, toAccount } from "@/lib/data/mappers";
import { getSession } from "@/lib/data/session";
import { deleteById, insertInto, raw, sql, updateWhere } from "@/lib/db/sql";
import type { UserDb } from "@/lib/db/user-db";
import { typeChangeAllowed } from "@/lib/domain/accounts";
import { adjustmentFor, buildEntries, type EntryInput } from "@/lib/domain/ledger";
import { nextOccurrence } from "@/lib/domain/recurrence";
import type { Account, Entry } from "@/lib/domain/types";
import {
  accountSchema,
  balanceAdjustmentSchema,
  fieldErrorsOf,
  formValues,
  ruleSchema,
  transactionSchema,
} from "@/lib/validation/schemas";

const INVALID = "Vérifiez les champs signalés.";

function refreshAll() {
  revalidatePath("/", "layout");
}

async function accountsMap(db: UserDb): Promise<Map<string, Account> | null> {
  const { data, error } = await db.rows(sql`select ${raw(ACCOUNT_COLUMNS)} from public.accounts`);
  if (error) return null;
  return new Map(data.map(toAccount).map((a) => [a.id, a]));
}

/** Enregistre une opération (fonction SQL atomique et auditée) ; renvoie son identifiant. */
const saveTransaction = (db: UserDb, p: Record<string, unknown>) =>
  db.row<{ id: string }>(sql`select public.save_transaction(${p}::jsonb) as id`);

const entriesPayload = (entries: Entry[]) => entries.map((e) => ({ account_id: e.accountId, amount_cents: e.amountCents }));

// -----------------------------------------------------------------------------
// Opérations
// -----------------------------------------------------------------------------

export async function saveTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = transactionSchema.safeParse(values);
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;

  // Aucune confirmation : le statut découle de la date (future = à venir,
  // sinon effectuée). Seule une opération annulée (échéance ignorée) le reste.
  const status = v.status === "cancelled" ? "cancelled" : v.date > todayParis() ? "planned" : "confirmed";

  const { db } = await getSession();
  const accounts = await accountsMap(db);
  if (!accounts) return failure("Impossible de vérifier vos comptes. Réessayez.");

  let entryInput: EntryInput;
  switch (v.kind) {
    case "expense":
      entryInput = {
        kind: "expense",
        amountCents: v.amount,
        accountId: v.account_id,
        voucherAccountId: v.voucher_account_id,
        voucherCents: v.voucher_amount,
      };
      break;
    case "income":
      entryInput = { kind: "income", amountCents: v.amount, accountId: v.account_id };
      break;
    case "transfer":
      entryInput = { kind: "transfer", amountCents: v.amount, fromAccountId: v.account_id, toAccountId: v.to_account_id! };
      break;
    case "adjustment":
      entryInput = { kind: "adjustment", amountCents: v.amount, accountId: v.account_id, direction: v.direction! };
      break;
  }
  const built = buildEntries(entryInput, accounts);
  if (!built.ok) return failure(built.error);

  const categoryId = v.kind === "expense" || v.kind === "income" ? v.category_id : null;
  if (categoryId) {
    const { data: category } = await db.row(sql`select id, kind from public.categories where id = ${categoryId}`);
    if (!category || category.kind !== v.kind) {
      return failure(INVALID, { category_id: "Catégorie incohérente avec le type de mouvement." });
    }
  }

  // Option « répéter » : crée la règle et lie cette opération comme sa première échéance.
  let recurrenceId = v.recurrence_id;
  let occurrenceDate = v.occurrence_date;
  let createdRuleId: string | null = null;
  if (v.repeat !== "none" && !v.id && v.kind !== "adjustment") {
    const { data: ruleRows, error: ruleError } = await db.returning(
      insertInto(
        "recurring_rules",
        {
          kind: v.kind,
          label: v.label,
          amount_cents: v.amount,
          account_id: v.account_id,
          to_account_id: v.kind === "transfer" ? v.to_account_id : null,
          category_id: categoryId,
          frequency: v.repeat,
          start_date: v.date,
          tracking_start: v.date,
        },
        "id",
      ),
    );
    const ruleRow = ruleRows?.[0];
    if (ruleError || !ruleRow) return failure(dbErrorMessage(ruleError));
    createdRuleId = String(ruleRow.id);
    recurrenceId = createdRuleId;
    occurrenceDate = v.date;
  }

  const { data: saved, error } = await saveTransaction(db, {
      id: v.id,
      client_request_id: v.client_request_id,
      kind: v.kind,
      status,
      date: v.date,
      label: v.label,
      notes: v.notes,
      amount_cents: v.amount,
      expected_amount_cents: v.expected_amount,
      category_id: categoryId,
      recurrence_id: recurrenceId,
      occurrence_date: occurrenceDate,
      is_exceptional: v.kind === "expense" && v.is_exceptional,
      entries: entriesPayload(built.entries),
  });
  if (error) {
    if (createdRuleId) await db.exec(deleteById("recurring_rules", createdRuleId));
    return failure(dbErrorMessage(error));
  }

  // L'opération réalise un achat planifié : il sort du calendrier d'achats.
  if (v.purchase_plan_id && status !== "cancelled") {
    await db.exec(updateWhere("purchase_plans", { status: "purchased" }, "id", v.purchase_plan_id));
  }

  refreshAll();
  redirect(safeReturnTo(values.return_to, `/operations/${String(saved?.id)}`));
}

/**
 * Supprime une opération. Une échéance récurrente n'est pas effacée mais
 * marquée « ignorée » (annulée) : sinon elle serait enregistrée de nouveau
 * automatiquement au chargement suivant. La règle continue pour les suivantes.
 */
export async function deleteTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { db } = await getSession();
  const { data: existing } = await db.row<{ recurrence_id: string | null }>(sql`select recurrence_id from public.transactions where id = ${id}`);
  const { error } = await db.exec(
    existing?.recurrence_id
      ? sql`select public.set_transaction_status(${id}::uuid, 'cancelled', null)`
      : sql`select public.delete_transaction(${id}::uuid)`,
  );
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect(safeReturnTo(String(formData.get("return_to") ?? ""), "/operations"));
}

// -----------------------------------------------------------------------------
// Comptes
// -----------------------------------------------------------------------------

export async function saveAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = accountSchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { db } = await getSession();

  const row = {
    name: v.name,
    type: v.type,
    subtype: v.subtype,
    opening_balance_cents: v.opening_balance,
    opening_balance_date: v.opening_balance_date,
    valid_until: v.type === "meal_voucher" ? v.valid_until : null,
    institution: v.institution,
    notes: v.notes,
  };

  let accountId = v.id;
  if (v.id) {
    const { data: existing } = await db.row(sql`select ${raw(ACCOUNT_COLUMNS)} from public.accounts where id = ${v.id}`);
    if (!existing) return failure("Compte introuvable.");
    const current = toAccount(existing);
    const { data: usage } = await db.row<{ used: boolean }>(sql`select exists (select 1 from public.entries where account_id = ${v.id}) as used`);
    const used = usage?.used ?? false;
    if (used && (current.openingBalanceCents !== v.opening_balance || current.openingBalanceDate !== v.opening_balance_date)) {
      return failure(INVALID, {
        opening_balance: "Ce compte a déjà des opérations : corrigez le solde par un ajustement explicite (page du compte).",
      });
    }
    if (!typeChangeAllowed(current.type, v.type, used)) {
      return failure(INVALID, {
        subtype:
          "Ce compte a déjà des opérations : il peut changer de type seulement dans la même famille (ex. Livret d'épargne → Livret A). Archivez-le et créez un nouveau compte.",
      });
    }
    const { error } = await db.exec(updateWhere("accounts", row, "id", v.id));
    if (error) return failure(dbErrorMessage(error));
  } else {
    const { data, error } = await db.returning(insertInto("accounts", row, "id"));
    if (error || !data[0]) return failure(dbErrorMessage(error));
    accountId = String(data[0].id);
  }
  refreshAll();
  redirect(`/comptes/${accountId}`);
}

export async function archiveAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "1";
  const { db } = await getSession();
  const { error } = await db.exec(updateWhere("accounts", { archived_at: archive ? new Date().toISOString() : null }, "id", id));
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(archive ? "Compte archivé : son historique est conservé." : "Compte réactivé.");
}

export async function deleteAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { db } = await getSession();
  const { error } = await db.exec(deleteById("accounts", id));
  if (error) return failure(dbErrorMessage(error, "delete_account"));
  refreshAll();
  redirect("/comptes");
}

/** Aligne le solde calculé sur le solde réellement constaté, par une écriture d'ajustement traçable. */
export async function adjustBalanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const today = todayParis();
  const parsed = balanceAdjustmentSchema.safeParse({ ...formValues(formData), date: today });
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { db } = await getSession();

  const { data: balanceRow, error: balanceError } = await db.row(
    sql`select balance_cents from public.account_balances where account_id = ${v.account_id}`,
  );
  if (balanceError || !balanceRow) return failure("Compte introuvable.");

  const adjustment = adjustmentFor(Number(balanceRow.balance_cents), v.observed_balance);
  if (!adjustment) return success("Aucun écart : le solde calculé correspond déjà au solde constaté.");

  const signed = adjustment.direction === "increase" ? adjustment.amountCents : -adjustment.amountCents;
  const { error } = await saveTransaction(db, {
      kind: "adjustment",
      status: "confirmed",
      date: today,
      label: v.label ?? "Ajustement de solde",
      amount_cents: adjustment.amountCents,
      client_request_id: String(formData.get("client_request_id") ?? "") || null,
      entries: [{ account_id: v.account_id, amount_cents: signed }],
  });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success("Ajustement enregistré.");
}

// -----------------------------------------------------------------------------
// Récurrences
// -----------------------------------------------------------------------------

export async function saveRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = ruleSchema.safeParse(values);
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { db } = await getSession();

  const row = {
    kind: v.kind,
    label: v.label,
    amount_cents: v.amount,
    account_id: v.account_id,
    to_account_id: v.kind === "transfer" ? v.to_account_id : null,
    category_id: v.kind === "transfer" ? null : v.category_id,
    frequency: v.frequency,
    start_date: v.start_date,
    end_date: v.end_date,
    certainty: v.certainty,
    is_active: v.is_active,
    notes: v.notes,
  };

  if (v.id && v.apply_from) {
    // Modification « à partir du » : la règle actuelle s'arrête la veille, une
    // nouvelle règle prend le relais. Les échéances passées restent inchangées.
    const start = nextOccurrence({ frequency: v.frequency, startDate: v.start_date, endDate: v.end_date }, v.apply_from);
    if (!start) return failure(INVALID, { apply_from: "Aucune échéance à partir de cette date." });
    const { error: endError } = await db.exec(updateWhere("recurring_rules", { end_date: addDays(v.apply_from, -1) }, "id", v.id));
    if (endError) return failure(dbErrorMessage(endError));
    const { error } = await db.exec(insertInto("recurring_rules", { ...row, start_date: start, tracking_start: v.apply_from }));
    if (error) return failure(dbErrorMessage(error));
  } else if (v.id) {
    const { error } = await db.exec(
      updateWhere("recurring_rules", { ...row, ...(v.tracking_start ? { tracking_start: v.tracking_start } : {}) }, "id", v.id),
    );
    if (error) return failure(dbErrorMessage(error));
  } else {
    const { error } = await db.exec(insertInto("recurring_rules", { ...row, tracking_start: v.tracking_start ?? todayParis() }));
    if (error) return failure(dbErrorMessage(error));
  }
  refreshAll();
  redirect(safeReturnTo(values.return_to, "/calendrier"));
}

export async function toggleRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  const { db } = await getSession();
  const { error } = await db.exec(updateWhere("recurring_rules", { is_active: active }, "id", id));
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(active ? "Récurrence réactivée." : "Récurrence suspendue : plus aucune échéance ne sera attendue.");
}

export async function deleteRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { db } = await getSession();
  const { error } = await db.exec(sql`select public.delete_recurring_rule(${id}::uuid)`);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect("/calendrier");
}
