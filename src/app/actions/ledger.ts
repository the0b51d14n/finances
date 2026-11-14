"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure, success, type ActionState } from "@/lib/actions/state";
import { formatDate, todayParis } from "@/lib/dates";
import { dbErrorMessage } from "@/lib/data/errors";
import { ACCOUNT_COLUMNS, CATEGORY_COLUMNS, toAccount, toCategory } from "@/lib/data/mappers";
import { getSession } from "@/lib/data/session";
import { deleteById, insertInto, raw, sql, updateWhere } from "@/lib/db/sql";
import type { UserDb } from "@/lib/db/user-db";
import { hasExpiry, typeChangeAllowed } from "@/lib/domain/accounts";
import { SALARIES, salaryAccount, salaryCategory } from "@/lib/domain/dashboard";
import { adjustmentFor, buildEntries, paysViaTransfer, planPayment } from "@/lib/domain/ledger";
import { firstDate, type Schedule } from "@/lib/domain/recurrence";
import type { Account, Entry } from "@/lib/domain/types";
import { formatCents } from "@/lib/money";
import {
  accountSchema,
  balanceAdjustmentSchema,
  expenseSchema,
  fieldErrorsOf,
  formValues,
  salarySchema,
  transferSchema,
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

const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const FREQUENCY: Record<Exclude<Schedule["repeat"], "none">, string> = { weekly: "weekly", monthly: "monthly", annual: "annual" };

/** Résumé lisible de l'échéancier, pour le message de confirmation. */
function scheduleText(schedule: Schedule, start: string): string {
  switch (schedule.repeat) {
    case "none":
      return `le ${formatDate(start)}`;
    case "weekly":
      return `chaque ${WEEKDAYS[schedule.weekday - 1]}`;
    case "monthly":
      return `chaque mois le ${schedule.day}`;
    case "annual":
      return `chaque année, dès le ${formatDate(start)}`;
  }
}

/**
 * Enregistre une dépense ou un virement : une fois (effectué si la date est
 * atteinte, sinon à venir), ou comme règle récurrente dont chaque échéance
 * s'enregistre seule à sa date (voir src/lib/domain/recurrence.ts).
 */
async function saveScheduled(
  db: UserDb,
  op: {
    kind: "expense" | "transfer";
    label: string;
    amountCents: number;
    accountId: string;
    toAccountId: string | null;
    categoryId: string | null;
    entries: Entry[];
    schedule: Schedule;
    requestId: string | null;
  },
): Promise<{ error: string | null; start: string }> {
  const today = todayParis();
  const start = firstDate(op.schedule, today);
  if (op.schedule.repeat === "none") {
    const { error } = await saveTransaction(db, {
      client_request_id: op.requestId,
      kind: op.kind,
      status: start > today ? "planned" : "confirmed",
      date: start,
      label: op.label,
      amount_cents: op.amountCents,
      category_id: op.categoryId,
      entries: entriesPayload(op.entries),
    });
    return { error: error ? dbErrorMessage(error) : null, start };
  }
  const { error } = await db.exec(
    insertInto("recurring_rules", {
      kind: op.kind,
      label: op.label,
      amount_cents: op.amountCents,
      account_id: op.accountId,
      to_account_id: op.toAccountId,
      category_id: op.categoryId,
      frequency: FREQUENCY[op.schedule.repeat],
      start_date: start,
      tracking_start: start,
    }),
  );
  return { error: error ? dbErrorMessage(error) : null, start };
}

/** Virement entre deux comptes, une fois ou récurrent. */
export async function addTransferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = transferSchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { db } = await getSession();

  const accounts = await accountsMap(db);
  if (!accounts) return failure("Impossible de vérifier vos comptes. Réessayez.");
  const from = accounts.get(v.from_account_id);
  const to = accounts.get(v.to_account_id);
  if (!from || from.archivedAt) return failure(INVALID, { from_account_id: "Compte invalide." });
  if (!to || to.archivedAt) return failure(INVALID, { to_account_id: "Compte invalide." });

  const built = buildEntries({ kind: "transfer", amountCents: v.amount, fromAccountId: from.id, toAccountId: to.id }, accounts);
  if (!built.ok) return failure(built.error);

  const saved = await saveScheduled(db, {
    kind: "transfer",
    label: v.label ?? `Virement vers ${to.name}`,
    amountCents: v.amount,
    accountId: from.id,
    toAccountId: to.id,
    categoryId: null,
    entries: built.entries,
    schedule: v.schedule,
    requestId: v.client_request_id,
  });
  if (saved.error) return failure(saved.error);
  refreshAll();
  return success(`Virement de ${formatCents(v.amount)} enregistré ${scheduleText(v.schedule, saved.start)}.`);
}

/** Note qui rattache un virement du chemin de l'argent à sa dépense. */
const PATH_NOTE = "chemin:";

/**
 * Supprime une opération (et les virements de son chemin de l'argent). Une
 * échéance récurrente est marquée annulée plutôt qu'effacée : sinon elle serait
 * recréée automatiquement au chargement suivant.
 */
export async function deleteTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { db } = await getSession();
  const { data: existing } = await db.row<{ recurrence_id: string | null; client_request_id: string | null }>(
    sql`select recurrence_id, client_request_id from public.transactions where id = ${id}`,
  );
  if (!existing) return failure("Opération introuvable.");
  // Virements du chemin de l'argent de cette dépense : supprimés avec elle.
  const { data: linked } = existing.client_request_id
    ? await db.rows<{ id: string }>(sql`select id from public.transactions where notes = ${PATH_NOTE + existing.client_request_id}`)
    : { data: [] as { id: string }[] };
  const { error } = await db.execAll([
    ...(linked ?? []).map((t) => sql`select public.delete_transaction(${t.id}::uuid)`),
    existing.recurrence_id
      ? sql`select public.set_transaction_status(${id}::uuid, 'cancelled', null)`
      : sql`select public.delete_transaction(${id}::uuid)`,
  ]);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success("Supprimé.");
}

/** Arrête une récurrence : plus aucune échéance ; celles déjà passées restent enregistrées. */
export async function deleteRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { db } = await getSession();
  const { error } = await db.exec(sql`select public.delete_recurring_rule(${id}::uuid)`);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success("Récurrence arrêtée.");
}

/** Dépense : nom, montant, domaine, compte, et quand (une fois ou récurrente). */
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

  const plan = planPayment(
    { amountCents: v.amount, accountId: account.id, payments: v.payments.map((p) => ({ accountId: p.account_id, amountCents: p.amount_cents })) },
    accounts,
  );
  if (!plan.ok) return failure(INVALID, { payments: plan.error });

  // Ce que chaque compte doit sortir (sa part de la dépense, ou son virement).
  const outflow = new Map<string, number>();
  const take = (id: string, cents: number) => outflow.set(id, (outflow.get(id) ?? 0) + cents);
  for (const e of plan.entries) if (e.amountCents < 0) take(e.accountId, -e.amountCents);
  for (const t of plan.transfers) take(t.fromAccountId, t.amountCents);
  // Carte cadeau, bon d'achat, tickets-restaurant, livrets : jamais plus que leur solde.
  const limited = [...outflow.keys()].filter((id) => {
    const a = accounts.get(id)!;
    return hasExpiry(a.type) || paysViaTransfer(a.type);
  });
  if (limited.length > 0) {
    const { data: rows } = await db.rows<{ account_id: string; balance_cents: number }>(
      sql`select account_id, balance_cents from public.account_balances where account_id in (select (jsonb_array_elements_text(${limited}::jsonb))::uuid)`,
    );
    for (const id of limited) {
      const available = Number(rows?.find((r) => r.account_id === id)?.balance_cents ?? 0);
      if (outflow.get(id)! > available) {
        const message = `${accounts.get(id)!.name} n'a que ${formatCents(Math.max(0, available))}.`;
        return failure(INVALID, id === account.id ? { account_id: message } : { payments: message });
      }
    }
  }

  const label = v.label ?? String(category.name);
  if (plan.transfers.length === 0) {
    const saved = await saveScheduled(db, {
      kind: "expense",
      label,
      amountCents: v.amount,
      accountId: account.id,
      toAccountId: null,
      categoryId: v.category_id,
      entries: plan.entries,
      schedule: v.schedule,
      requestId: v.client_request_id,
    });
    if (saved.error) return failure(saved.error);
    refreshAll();
    return success(`Dépense de ${formatCents(v.amount)} enregistrée ${scheduleText(v.schedule, saved.start)}.`);
  }

  // Chemin de l'argent : virements depuis les livrets vers le compte qui paie,
  // puis la dépense, dans une seule transaction (tout ou rien). Les virements
  // sont rattachés à la dépense (notes « chemin:<id de requête> ») pour être
  // supprimés avec elle.
  const today = todayParis();
  const date = firstDate(v.schedule, today);
  const status = date > today ? "planned" : "confirmed";
  const link = v.client_request_id ?? randomUUID();
  const { error } = await db.execAll([
    ...plan.transfers.map(
      (t) => sql`select public.save_transaction(${{
        kind: "transfer",
        status,
        date,
        label: `Virement pour « ${label} »`,
        notes: `${PATH_NOTE}${link}`,
        amount_cents: t.amountCents,
        entries: [
          { account_id: t.fromAccountId, amount_cents: -t.amountCents },
          { account_id: t.toAccountId, amount_cents: t.amountCents },
        ],
      }}::jsonb)`,
    ),
    sql`select public.save_transaction(${{
      client_request_id: link,
      kind: "expense",
      status,
      date,
      label,
      amount_cents: v.amount,
      category_id: v.category_id,
      entries: entriesPayload(plan.entries),
    }}::jsonb)`,
  ]);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  const via = plan.transfers.map((t) => accounts.get(t.fromAccountId)!.name).join(", ");
  return success(`Dépense de ${formatCents(v.amount)} enregistrée, avec virement depuis ${via}.`);
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
