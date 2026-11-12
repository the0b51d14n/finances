"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure, safeReturnTo, success, type ActionState } from "@/lib/actions/state";
import { addDays, isValidIsoDate, todayParis } from "@/lib/dates";
import { dbErrorMessage } from "@/lib/data/errors";
import { loadFinanceData } from "@/lib/data/load";
import { ACCOUNT_COLUMNS, toAccount } from "@/lib/data/mappers";
import { getSession } from "@/lib/data/session";
import { deleteById, insertInto, raw, sql, updateWhere, type Query } from "@/lib/db/sql";
import type { UserDb } from "@/lib/db/user-db";
import { balancesAt, hasExpiry, typeChangeAllowed } from "@/lib/domain/accounts";
import { forecastEventsFor } from "@/lib/domain/dashboard";
import { adjustmentFor, buildEntries, type EntryInput } from "@/lib/domain/ledger";
import { proposeMoneyPath } from "@/lib/domain/money-path";
import { nextOccurrence, planStopFrom } from "@/lib/domain/recurrence";
import type { Account, Entry } from "@/lib/domain/types";
import { centsToInput, parseAmountToCents } from "@/lib/money";
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

  // Option « répéter » : crée la règle et lie cette opération comme sa première
  // échéance. Identifiant dérivé de celui de la requête : une double soumission
  // ne recrée pas la règle.
  const ruleId = v.repeat !== "none" && !v.id && v.kind !== "adjustment" ? derivedId(v.client_request_id, "regle") : null;
  const recurrenceId = ruleId ?? v.recurrence_id;
  const occurrenceDate = ruleId ? v.date : v.occurrence_date;
  const ruleInserts: Query[] = [];
  if (ruleId) {
    ruleInserts.push(
      insertRule({
        id: ruleId,
        kind: v.kind,
        label: v.label,
        amount_cents: v.amount,
        account_id: v.account_id,
        to_account_id: v.kind === "transfer" ? v.to_account_id : null,
        category_id: categoryId,
        frequency: v.repeat,
        start_date: v.date,
        tracking_start: v.date,
      }),
    );
  }

  // Chemin de l'argent : virements préalables, enregistrés avec la dépense. Si
  // elle est récurrente, chaque virement devient un virement récurrent de même
  // fréquence (même écart avec la dépense), rattaché à elle : il revient à
  // chaque échéance. Ce virement-ci est sa première échéance.
  const today = todayParis();
  const pathPayloads: Record<string, unknown>[] = [];
  for (const [i, step] of v.path.entries()) {
    const transfer = buildEntries(
      { kind: "transfer", amountCents: step.amount_cents, fromAccountId: step.from_account_id, toAccountId: step.to_account_id },
      accounts,
    );
    if (!transfer.ok) return failure(INVALID, { path: `Virement ${i + 1} du chemin : ${transfer.error}` });
    const label = `Virement pour « ${v.label} »`;
    const stepRuleId = ruleId ? derivedId(v.client_request_id, `regle:chemin:${i}`) : null;
    if (stepRuleId) {
      ruleInserts.push(
        insertRule({
          id: stepRuleId,
          kind: "transfer",
          label,
          amount_cents: step.amount_cents,
          account_id: step.from_account_id,
          to_account_id: step.to_account_id,
          category_id: null,
          frequency: v.repeat,
          start_date: step.date,
          tracking_start: step.date,
          funded_rule_id: ruleId,
        }),
      );
    }
    pathPayloads.push({
      client_request_id: stepRequestId(v.client_request_id, i),
      kind: "transfer",
      status: step.date > today ? "planned" : "confirmed",
      date: step.date,
      label,
      amount_cents: step.amount_cents,
      recurrence_id: stepRuleId,
      occurrence_date: stepRuleId ? step.date : null,
      entries: entriesPayload(transfer.entries),
    });
  }

  const payload = {
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
  };

  // Règles, virements et dépense dans une seule transaction : tout est enregistré, ou rien.
  const saves = [...pathPayloads, payload].map((p) => sql`select public.save_transaction(${p}::jsonb) as id`);
  let savedId: string | undefined;
  let error;
  if (ruleId) {
    const res = await db.execAll([...ruleInserts, ...saves]);
    error = res.error;
    if (!error) {
      const found = await db.row<{ id: string }>(
        sql`select id from public.transactions where recurrence_id = ${ruleId} and occurrence_date = ${v.date}`,
      );
      savedId = found.data?.id;
    }
  } else if (saves.length > 1) {
    const res = await db.batch(saves);
    error = res.error;
    savedId = res.data?.at(-1)?.[0]?.id as string | undefined;
  } else {
    const res = await saveTransaction(db, payload);
    error = res.error;
    savedId = res.data?.id;
  }
  if (error) return failure(dbErrorMessage(error));

  // L'opération réalise un achat planifié : il sort du calendrier d'achats.
  if (v.purchase_plan_id && status !== "cancelled") {
    await db.exec(updateWhere("purchase_plans", { status: "purchased" }, "id", v.purchase_plan_id));
  }

  refreshAll();
  redirect(safeReturnTo(values.return_to, savedId ? `/operations/${savedId}` : "/operations"));
}

/** UUID déterministe (version 5, SHA-256) tiré d'une graine. */
function uuidFrom(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Identifiant de requête de la n-ième étape d'un chemin, dérivé de celui de la
 * dépense : une double soumission ne recrée aucun virement (même UUID).
 */
function stepRequestId(requestId: string | null, index: number): string | null {
  return requestId ? uuidFrom(`${requestId}:chemin:${index}`) : null;
}

/** Identifiant d'une règle créée avec l'opération, dérivé de la requête (sinon aléatoire). */
function derivedId(requestId: string | null, tag: string): string {
  return requestId ? uuidFrom(`${requestId}:${tag}`) : randomUUID();
}

/** Crée une règle ; déjà présente (double soumission), elle reste telle quelle. */
const insertRule = (row: Record<string, unknown>) => sql`${insertInto("recurring_rules", row)} on conflict (id) do nothing`;

export type MoneyPathResult =
  | {
      ok: true;
      steps: { from_account_id: string; to_account_id: string; amount: string; date: string }[];
      shortfallCents: number;
      uncoveredCents: number;
    }
  | { ok: false; error: string };

/**
 * Propose le chemin de l'argent d'une dépense, ou de la première échéance d'une
 * dépense récurrente (voir src/lib/domain/money-path.ts). Ne modifie rien : le
 * formulaire affiche la proposition, modifiable, et l'enregistre avec la dépense.
 */
export async function proposeMoneyPathAction(accountId: string, amount: string, date: string): Promise<MoneyPathResult> {
  const amountCents = parseAmountToCents(amount);
  if (!amountCents || amountCents <= 0) return { ok: false, error: "Saisissez d'abord le montant de la dépense." };
  if (!accountId) return { ok: false, error: "Choisissez d'abord le compte qui paie." };
  if (!isValidIsoDate(date)) return { ok: false, error: "Saisissez d'abord la date de la dépense." };

  const data = await loadFinanceData();
  const proposal = proposeMoneyPath({
    today: data.today,
    accounts: data.accounts,
    balances: balancesAt(data.accounts, data.transactions, data.today),
    events: forecastEventsFor(data),
    rules: data.rules,
    withBudgets: data.settings.preserveBudgetsInForecast,
    payerAccountId: accountId,
    amountCents,
    date,
  });
  return {
    ok: true,
    steps: proposal.steps.map((s) => ({ from_account_id: s.fromAccountId, to_account_id: s.toAccountId, amount: centsToInput(s.amountCents), date: s.date })),
    shortfallCents: proposal.shortfallCents,
    uncoveredCents: proposal.uncoveredCents,
  };
}

/**
 * Supprime une opération. Une échéance récurrente n'est pas effacée mais
 * marquée « ignorée » (annulée) : sinon elle serait enregistrée de nouveau
 * automatiquement au chargement suivant. La règle continue pour les suivantes.
 */
export async function deleteTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const returnTo = safeReturnTo(String(formData.get("return_to") ?? ""), "/operations");
  const { db } = await getSession();

  // « Celle-ci et les suivantes » : la récurrence (et son chemin de l'argent)
  // s'arrête avant cette échéance ; les opérations de cette échéance et des
  // suivantes sont supprimées. Tout ou rien, dans une seule transaction.
  if (formData.get("scope") === "following") {
    const data = await loadFinanceData();
    const tx = data.transactions.find((t) => t.id === id);
    const rule = tx?.recurrenceId ? data.rules.find((r) => r.id === tx.recurrenceId) : undefined;
    if (!tx || !rule || !tx.occurrenceDate) return failure("Échéance récurrente introuvable.");
    const plan = planStopFrom(rule, tx.occurrenceDate, data.rules, data.transactions);
    const { error } = await db.execAll([
      ...plan.transactionIds.map((txId) => sql`select public.delete_transaction(${txId}::uuid)`),
      ...plan.endRules.map((r) => updateWhere("recurring_rules", { end_date: r.endDate }, "id", r.id)),
      ...plan.deleteRuleIds.map((ruleId) => sql`select public.delete_recurring_rule(${ruleId}::uuid)`),
    ]);
    if (error) return failure(dbErrorMessage(error));
    refreshAll();
    redirect(returnTo);
  }

  const { data: existing } = await db.row<{ recurrence_id: string | null }>(sql`select recurrence_id from public.transactions where id = ${id}`);
  const { error } = await db.exec(
    existing?.recurrence_id
      ? sql`select public.set_transaction_status(${id}::uuid, 'cancelled', null)`
      : sql`select public.delete_transaction(${id}::uuid)`,
  );
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect(returnTo);
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
    valid_until: hasExpiry(v.type) ? v.valid_until : null,
    institution: v.institution,
    notes: v.notes,
    // Tableau PostgreSQL (smallint[]) : les tableaux JS seraient transmis en JSON.
    closed_weekdays: `{${([1, 2, 3, 4, 5] as const).filter((d) => v[`closed_weekday_${d}`]).join(",")}}`,
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

  // Virements du chemin de l'argent : ils suivent la dépense qu'ils alimentent
  // (fréquence, fin, suspension). Leur montant et leur date restent les leurs.
  const followers = (ruleId: string) => ({ frequency: v.frequency, end_date: v.end_date, is_active: v.is_active, funded_rule_id: ruleId });

  if (v.id && v.apply_from) {
    // Modification « à partir du » : la règle actuelle s'arrête la veille, une
    // nouvelle règle prend le relais. Les échéances passées restent inchangées.
    const start = nextOccurrence({ frequency: v.frequency, startDate: v.start_date, endDate: v.end_date }, v.apply_from);
    if (!start) return failure(INVALID, { apply_from: "Aucune échéance à partir de cette date." });
    const { data: current } = await db.row<{ funded_rule_id: string | null }>(sql`select funded_rule_id from public.recurring_rules where id = ${v.id}`);
    if (!current) return failure("Échéance récurrente introuvable.");
    const nextId = randomUUID();
    const { error } = await db.execAll([
      updateWhere("recurring_rules", { end_date: addDays(v.apply_from, -1) }, "id", v.id),
      insertInto("recurring_rules", {
        ...row,
        id: nextId,
        start_date: start,
        tracking_start: v.apply_from,
        funded_rule_id: v.kind === "transfer" ? current.funded_rule_id : null,
      }),
      updateWhere("recurring_rules", followers(nextId), "funded_rule_id", v.id),
    ]);
    if (error) return failure(dbErrorMessage(error));
  } else if (v.id) {
    const { error } = await db.execAll([
      updateWhere(
        "recurring_rules",
        {
          ...row,
          ...(v.tracking_start ? { tracking_start: v.tracking_start } : {}),
          // Un virement du chemin changé en dépense ou revenu n'alimente plus rien.
          ...(v.kind !== "transfer" ? { funded_rule_id: null } : {}),
        },
        "id",
        v.id,
      ),
      updateWhere("recurring_rules", followers(v.id), "funded_rule_id", v.id),
    ]);
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
  // Les virements du chemin de l'argent sont suspendus ou réactivés avec la dépense.
  const { error } = await db.execAll([
    updateWhere("recurring_rules", { is_active: active }, "id", id),
    updateWhere("recurring_rules", { is_active: active }, "funded_rule_id", id),
  ]);
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
