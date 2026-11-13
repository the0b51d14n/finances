"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure, success, type ActionState } from "@/lib/actions/state";
import { todayParis } from "@/lib/dates";
import { dbErrorMessage } from "@/lib/data/errors";
import { ACCOUNT_COLUMNS, CATEGORY_COLUMNS, toAccount, toCategory } from "@/lib/data/mappers";
import { getSession } from "@/lib/data/session";
import { deleteById, insertInto, raw, sql, updateWhere } from "@/lib/db/sql";
import type { UserDb } from "@/lib/db/user-db";
import { hasExpiry, typeChangeAllowed } from "@/lib/domain/accounts";
import { SALARIES, salaryAccount, salaryCategory } from "@/lib/domain/dashboard";
import { adjustmentFor, buildEntries } from "@/lib/domain/ledger";
import type { Account, Entry } from "@/lib/domain/types";
import { formatCents } from "@/lib/money";
import { accountSchema, balanceAdjustmentSchema, expenseSchema, fieldErrorsOf, formValues, salarySchema } from "@/lib/validation/schemas";

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

const requestId = (formData: FormData) => String(formData.get("client_request_id") ?? "") || null;

// -----------------------------------------------------------------------------
// Tableau de bord
// -----------------------------------------------------------------------------

/** Salaire reçu : crédite le compte courant secondaire, daté d'aujourd'hui. */
export async function addSalaryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = salarySchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const salary = SALARIES.find((s) => s.key === v.salary)!;
  const { db } = await getSession();

  const accounts = await accountsMap(db);
  if (!accounts) return failure("Impossible de vérifier vos comptes. Réessayez.");
  const account = salaryAccount([...accounts.values()]);
  if (!account) return failure("Créez d'abord votre compte courant secondaire (onglet Comptes).");

  const { data: categories } = await db.rows(sql`select ${raw(CATEGORY_COLUMNS)} from public.categories where kind = 'income'`);
  const category = salaryCategory(salary.key, (categories ?? []).map(toCategory));

  const { error } = await saveTransaction(db, {
    client_request_id: v.client_request_id,
    kind: "income",
    status: "confirmed",
    date: todayParis(),
    label: salary.label,
    amount_cents: v.amount,
    category_id: category?.id ?? null,
    entries: [{ account_id: account.id, amount_cents: v.amount }],
  });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(`${formatCents(v.amount)} ajoutés sur ${account.name}.`);
}

/** Dépense rapide : montant, domaine et compte, datée d'aujourd'hui. */
export async function addExpenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = expenseSchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { db } = await getSession();

  const accounts = await accountsMap(db);
  if (!accounts) return failure("Impossible de vérifier vos comptes. Réessayez.");
  const account = accounts.get(v.account_id);
  if (!account || account.archivedAt) return failure(INVALID, { account_id: "Compte invalide." });

  const { data: category } = await db.row(sql`select ${raw(CATEGORY_COLUMNS)} from public.categories where id = ${v.category_id}`);
  if (!category || category.kind !== "expense") return failure(INVALID, { category_id: "Domaine invalide." });

  // Carte cadeau, bon d'achat, tickets-restaurant : jamais plus que leur solde.
  if (hasExpiry(account.type)) {
    const { data: row } = await db.row<{ balance_cents: number }>(
      sql`select balance_cents from public.account_balances where account_id = ${account.id}`,
    );
    const available = Number(row?.balance_cents ?? 0);
    if (v.amount > available) {
      return failure(INVALID, { account_id: `${account.name} n'a que ${formatCents(Math.max(0, available))}.` });
    }
  }

  const built = buildEntries({ kind: "expense", amountCents: v.amount, accountId: account.id }, accounts);
  if (!built.ok) return failure(built.error);

  const { error } = await saveTransaction(db, {
    client_request_id: v.client_request_id,
    kind: "expense",
    status: "confirmed",
    date: todayParis(),
    label: String(category.name),
    amount_cents: v.amount,
    category_id: v.category_id,
    entries: entriesPayload(built.entries),
  });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(`Dépense de ${formatCents(v.amount)} enregistrée.`);
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
      client_request_id: requestId(formData),
      entries: [{ account_id: v.account_id, amount_cents: signed }],
  });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success("Ajustement enregistré.");
}
