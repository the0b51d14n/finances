"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure, safeReturnTo, success, type ActionState } from "@/lib/actions/state";
import { addDays, todayParis } from "@/lib/dates";
import { dbErrorMessage } from "@/lib/data/errors";
import { ACCOUNT_COLUMNS, RULE_COLUMNS, toAccount, toRule } from "@/lib/data/mappers";
import { getSession } from "@/lib/data/session";
import { adjustmentFor, buildEntries, type EntryInput } from "@/lib/domain/ledger";
import { nextOccurrence, occurrenceDates } from "@/lib/domain/recurrence";
import type { Account, Entry } from "@/lib/domain/types";
import { parseAmountToCents } from "@/lib/money";
import type { ServerSupabase } from "@/lib/supabase/server";
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

async function accountsMap(supabase: ServerSupabase): Promise<Map<string, Account> | null> {
  const { data, error } = await supabase.from("accounts").select(ACCOUNT_COLUMNS);
  if (error || !data) return null;
  return new Map(data.map((r) => toAccount(r as Record<string, unknown>)).map((a) => [a.id, a]));
}

const entriesPayload = (entries: Entry[]) => entries.map((e) => ({ account_id: e.accountId, amount_cents: e.amountCents }));

// -----------------------------------------------------------------------------
// Opérations
// -----------------------------------------------------------------------------

export async function saveTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = transactionSchema.safeParse(values);
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;

  if (v.status === "confirmed" && v.date > todayParis()) {
    return failure(INVALID, { date: "Date future : choisissez le statut « Prévue » pour une opération à venir." });
  }

  const { supabase } = await getSession();
  const accounts = await accountsMap(supabase);
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
    const { data: category } = await supabase.from("categories").select("id, kind").eq("id", categoryId).maybeSingle();
    if (!category || category.kind !== v.kind) {
      return failure(INVALID, { category_id: "Catégorie incohérente avec le type de mouvement." });
    }
  }

  // Option « répéter » : crée la règle et lie cette opération comme sa première échéance.
  let recurrenceId = v.recurrence_id;
  let occurrenceDate = v.occurrence_date;
  let createdRuleId: string | null = null;
  if (v.repeat !== "none" && !v.id && v.kind !== "adjustment") {
    const { data: ruleRow, error: ruleError } = await supabase
      .from("recurring_rules")
      .insert({
        kind: v.kind,
        label: v.label,
        amount_cents: v.amount,
        account_id: v.account_id,
        to_account_id: v.kind === "transfer" ? v.to_account_id : null,
        category_id: categoryId,
        frequency: v.repeat,
        start_date: v.date,
        tracking_start: v.date,
      })
      .select("id")
      .single();
    if (ruleError || !ruleRow) return failure(dbErrorMessage(ruleError));
    createdRuleId = String(ruleRow.id);
    recurrenceId = createdRuleId;
    occurrenceDate = v.date;
  }

  const { data: savedId, error } = await supabase.rpc("save_transaction", {
    p: {
      id: v.id,
      client_request_id: v.client_request_id,
      kind: v.kind,
      status: v.status,
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
    },
  });
  if (error) {
    if (createdRuleId) await supabase.from("recurring_rules").delete().eq("id", createdRuleId);
    return failure(dbErrorMessage(error));
  }

  // L'opération réalise un achat planifié : il sort du calendrier d'achats.
  if (v.purchase_plan_id && v.status === "confirmed") {
    await supabase.from("purchase_plans").update({ status: "purchased" }).eq("id", v.purchase_plan_id);
  }

  refreshAll();
  redirect(safeReturnTo(values.return_to, `/operations/${String(savedId)}`));
}

export async function setTransactionStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const date = String(formData.get("date") ?? "") || null;
  if (!["planned", "confirmed", "cancelled"].includes(status)) return failure("Statut invalide.");
  if (status === "confirmed" && (date ?? "") > todayParis()) {
    return failure("Une opération ne peut être confirmée qu'une fois sa date passée.");
  }
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("set_transaction_status", { p_id: id, p_status: status, p_date: date });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(status === "confirmed" ? "Opération confirmée." : status === "cancelled" ? "Opération annulée." : "Opération repassée en prévue.");
}

export async function deleteTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("delete_transaction", { p_id: id });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect(safeReturnTo(String(formData.get("return_to") ?? ""), "/operations"));
}

/**
 * Réalise (confirme) ou ignore une échéance récurrente. Le montant réel peut
 * différer du montant estimé, conservé dans expected_amount_cents.
 */
export async function resolveOccurrenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const mode = String(formData.get("mode") ?? "confirm");
  const ruleId = String(formData.get("rule_id") ?? "");
  const occurrenceDate = String(formData.get("occurrence_date") ?? "");
  const today = todayParis();

  const { supabase } = await getSession();
  const { data: ruleRow, error: ruleError } = await supabase.from("recurring_rules").select(RULE_COLUMNS).eq("id", ruleId).maybeSingle();
  if (ruleError || !ruleRow) return failure("Échéance introuvable.");
  const rule = toRule(ruleRow as Record<string, unknown>);
  if (!occurrenceDates(rule, occurrenceDate, occurrenceDate).includes(occurrenceDate)) {
    return failure("Cette date ne correspond à aucune échéance de la règle.");
  }

  const date = mode === "skip" ? occurrenceDate : String(formData.get("date") ?? "") || occurrenceDate;
  const rawAmount = String(formData.get("amount") ?? "");
  const amountCents = mode === "skip" || rawAmount === "" ? rule.amountCents : parseAmountToCents(rawAmount);
  if (!amountCents || amountCents <= 0) return failure("Montant invalide.");
  const status = mode === "skip" ? "cancelled" : date > today ? "planned" : "confirmed";

  const accounts = await accountsMap(supabase);
  if (!accounts) return failure("Impossible de vérifier vos comptes. Réessayez.");
  const input: EntryInput =
    rule.kind === "transfer"
      ? { kind: "transfer", amountCents, fromAccountId: rule.accountId, toAccountId: rule.toAccountId! }
      : { kind: rule.kind, amountCents, accountId: rule.accountId };
  const built = buildEntries(input, accounts);
  if (!built.ok) return failure(built.error);

  const { error } = await supabase.rpc("save_transaction", {
    p: {
      kind: rule.kind,
      status,
      date,
      label: rule.label,
      amount_cents: amountCents,
      expected_amount_cents: rule.amountCents,
      category_id: rule.categoryId,
      recurrence_id: rule.id,
      occurrence_date: occurrenceDate,
      entries: entriesPayload(built.entries),
    },
  });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(mode === "skip" ? "Échéance ignorée." : status === "planned" ? "Échéance planifiée." : "Échéance confirmée.");
}

// -----------------------------------------------------------------------------
// Comptes
// -----------------------------------------------------------------------------

export async function saveAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = accountSchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { supabase } = await getSession();

  const row = {
    name: v.name,
    type: v.type,
    opening_balance_cents: v.opening_balance,
    opening_balance_date: v.opening_balance_date,
    valid_until: v.type === "meal_voucher" ? v.valid_until : null,
    institution: v.institution,
    notes: v.notes,
  };

  let accountId = v.id;
  if (v.id) {
    const { data: existing } = await supabase.from("accounts").select(ACCOUNT_COLUMNS).eq("id", v.id).maybeSingle();
    if (!existing) return failure("Compte introuvable.");
    const current = toAccount(existing as Record<string, unknown>);
    const { count } = await supabase.from("entries").select("id", { count: "exact", head: true }).eq("account_id", v.id);
    const used = (count ?? 0) > 0;
    if (used && (current.openingBalanceCents !== v.opening_balance || current.openingBalanceDate !== v.opening_balance_date)) {
      return failure(INVALID, {
        opening_balance: "Ce compte a déjà des opérations : corrigez le solde par un ajustement explicite (page du compte).",
      });
    }
    if (used && current.type !== v.type && (current.type === "meal_voucher" || v.type === "meal_voucher")) {
      return failure(INVALID, { type: "Un compte utilisé ne peut pas devenir ou cesser d'être un portefeuille de tickets." });
    }
    const { error } = await supabase.from("accounts").update(row).eq("id", v.id);
    if (error) return failure(dbErrorMessage(error));
  } else {
    const { data, error } = await supabase.from("accounts").insert(row).select("id").single();
    if (error || !data) return failure(dbErrorMessage(error));
    accountId = String(data.id);
  }
  refreshAll();
  redirect(`/comptes/${accountId}`);
}

export async function archiveAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "1";
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("accounts")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(archive ? "Compte archivé : son historique est conservé." : "Compte réactivé.");
}

export async function deleteAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { supabase } = await getSession();
  const { error } = await supabase.from("accounts").delete().eq("id", id);
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
  const { supabase } = await getSession();

  const { data: balanceRow, error: balanceError } = await supabase
    .from("account_balances")
    .select("balance_cents")
    .eq("account_id", v.account_id)
    .maybeSingle();
  if (balanceError || !balanceRow) return failure("Compte introuvable.");

  const adjustment = adjustmentFor(Number(balanceRow.balance_cents), v.observed_balance);
  if (!adjustment) return success("Aucun écart : le solde calculé correspond déjà au solde constaté.");

  const signed = adjustment.direction === "increase" ? adjustment.amountCents : -adjustment.amountCents;
  const { error } = await supabase.rpc("save_transaction", {
    p: {
      kind: "adjustment",
      status: "confirmed",
      date: today,
      label: v.label ?? "Ajustement de solde",
      amount_cents: adjustment.amountCents,
      client_request_id: String(formData.get("client_request_id") ?? "") || null,
      entries: [{ account_id: v.account_id, amount_cents: signed }],
    },
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
  const { supabase } = await getSession();

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
    const { error: endError } = await supabase.from("recurring_rules").update({ end_date: addDays(v.apply_from, -1) }).eq("id", v.id);
    if (endError) return failure(dbErrorMessage(endError));
    const { error } = await supabase.from("recurring_rules").insert({ ...row, start_date: start, tracking_start: v.apply_from });
    if (error) return failure(dbErrorMessage(error));
  } else if (v.id) {
    const { error } = await supabase
      .from("recurring_rules")
      .update({ ...row, ...(v.tracking_start ? { tracking_start: v.tracking_start } : {}) })
      .eq("id", v.id);
    if (error) return failure(dbErrorMessage(error));
  } else {
    const { error } = await supabase.from("recurring_rules").insert({ ...row, tracking_start: v.tracking_start ?? todayParis() });
    if (error) return failure(dbErrorMessage(error));
  }
  refreshAll();
  redirect(safeReturnTo(values.return_to, "/calendrier"));
}

export async function toggleRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  const { supabase } = await getSession();
  const { error } = await supabase.from("recurring_rules").update({ is_active: active }).eq("id", id);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(active ? "Récurrence réactivée." : "Récurrence suspendue : plus aucune échéance ne sera attendue.");
}

export async function deleteRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("delete_recurring_rule", { p_id: id });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect("/calendrier");
}
