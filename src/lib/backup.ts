/**
 * Sauvegarde (export JSON), export CSV et lecture d'une sauvegarde à réimporter.
 *
 * Le format JSON est le contrat entre l'export et le réimport : la lecture
 * vérifie chaque champ et chaque référence (compte, catégorie, règle, objectif)
 * avant de produire la charge utile de la fonction SQL import_backup, qui
 * revérifie tout par les contraintes de la base.
 */
import { z } from "zod";
import { isValidIsoDate } from "@/lib/dates";
import type { FinanceData } from "@/lib/data/load";
import { ACCOUNT_SUBTYPE_KEYS, DEFAULT_SUBTYPE } from "@/lib/domain/account-kinds";
import type { AccountType } from "@/lib/domain/types";
import { centsToInput } from "@/lib/money";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/view/labels";

export const BACKUP_FORMAT = "finances-perso";
export const BACKUP_VERSION = 1;

type BackupSource = Omit<FinanceData, "today" | "email">;

export function buildBackup(data: BackupSource, exportedAt: string) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    currency: "EUR",
    amountsUnit: "centimes",
    settings: data.settings,
    accounts: data.accounts,
    categories: data.categories,
    transactions: data.transactions,
    recurringRules: data.rules,
    budgets: data.budgets,
    savingsGoals: data.goals,
    goalAllocations: data.allocations,
    purchasePlans: data.purchasePlans,
  };
}

/** Opérations au format tableur français : « ; », virgule décimale, BOM UTF-8, du plus ancien au plus récent. */
export function buildOperationsCsv(data: Pick<FinanceData, "accounts" | "categories" | "transactions">): string {
  const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
  const categories = new Map(data.categories.map((c) => [c.id, c.name]));
  const cell = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    ["Date", "Libellé", "Type", "Statut", "Montant", "Catégorie", "Écritures", "Exceptionnelle", "Notes", "Identifiant"].join(";"),
    ...[...data.transactions].reverse().map((t) =>
      [
        t.date,
        t.label,
        KIND_LABELS[t.kind],
        STATUS_LABELS[t.status],
        centsToInput(t.kind === "expense" ? -t.amountCents : t.amountCents),
        t.categoryId ? (categories.get(t.categoryId) ?? "") : "",
        t.entries.map((e) => `${accounts.get(e.accountId) ?? "?"} ${centsToInput(e.amountCents)}`).join(" | "),
        t.isExceptional ? "oui" : "",
        t.notes ?? "",
        t.id,
      ]
        .map((v) => cell(String(v)))
        .join(";"),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

// -----------------------------------------------------------------------------
// Lecture d'une sauvegarde
// -----------------------------------------------------------------------------

const MAX_CENTS = 100_000_000_000;
const ref = z.string().min(1).max(100);
const date = z.string().refine(isValidIsoDate, "date invalide");
const timestamp = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "horodatage invalide");
const cents = z.number().int().refine((v) => Math.abs(v) <= MAX_CENTS, "montant hors limites");
const positiveCents = cents.refine((v) => v > 0, "montant non positif");
const text = (max: number) => z.string().max(max);
const ACCOUNT_TYPES = Object.keys(DEFAULT_SUBTYPE) as [AccountType, ...AccountType[]];
const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"] as const;

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  settings: z
    .object({
      theme: z.enum(["dark", "light", "system"]),
      safetyReserveCents: cents.refine((v) => v >= 0),
      budgetAlertPct: z.number().int().min(1).max(100),
      billReminderDays: z.number().int().min(1).max(60),
      comparisonMonths: z.number().int().min(2).max(24),
      forecastIncludeProbable: z.boolean(),
      preserveBudgetsInForecast: z.boolean(),
      notifyBudgetAlerts: z.boolean(),
      notifyUpcomingBills: z.boolean(),
      notifyLowBalance: z.boolean(),
      spendingAccountId: ref.nullable().optional(),
    })
    .partial()
    .optional(),
  accounts: z
    .array(
      z.object({
        id: ref,
        name: z.string().trim().min(1).max(80),
        type: z.enum(ACCOUNT_TYPES),
        subtype: z.enum(ACCOUNT_SUBTYPE_KEYS).nullable().optional(),
        openingBalanceCents: cents,
        openingBalanceDate: date,
        validUntil: date.nullable().optional(),
        institution: text(60).nullable().optional(),
        notes: text(1000).nullable().optional(),
        archivedAt: timestamp.nullable().optional(),
      }),
    )
    .default([]),
  categories: z
    .array(
      z.object({
        id: ref,
        kind: z.enum(["expense", "income"]),
        name: z.string().trim().min(1).max(60),
        systemKey: z.string().regex(/^[a-z_]{2,40}$/).nullable().optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
        sortOrder: z.number().int().optional(),
        archivedAt: timestamp.nullable().optional(),
      }),
    )
    .default([]),
  recurringRules: z
    .array(
      z.object({
        id: ref,
        kind: z.enum(["expense", "income", "transfer"]),
        label: z.string().trim().min(1).max(140),
        amountCents: positiveCents,
        accountId: ref,
        toAccountId: ref.nullable().optional(),
        categoryId: ref.nullable().optional(),
        frequency: z.enum(FREQUENCIES),
        startDate: date,
        endDate: date.nullable().optional(),
        trackingStart: date,
        certainty: z.enum(["certain", "probable", "uncertain"]),
        isActive: z.boolean(),
        notes: text(1000).nullable().optional(),
      }),
    )
    .default([]),
  transactions: z
    .array(
      z.object({
        kind: z.enum(["expense", "income", "transfer", "adjustment"]),
        status: z.enum(["planned", "confirmed", "cancelled"]),
        date,
        label: z.string().trim().min(1).max(140),
        notes: text(2000).nullable().optional(),
        amountCents: positiveCents,
        expectedAmountCents: positiveCents.nullable().optional(),
        categoryId: ref.nullable().optional(),
        recurrenceId: ref.nullable().optional(),
        occurrenceDate: date.nullable().optional(),
        isExceptional: z.boolean().optional(),
        createdAt: timestamp.optional(),
        confirmedAt: timestamp.nullable().optional(),
        entries: z.array(z.object({ accountId: ref, amountCents: cents.refine((v) => v !== 0) })).min(1),
      }),
    )
    .default([]),
  budgets: z
    .array(
      z.object({
        categoryId: ref,
        period: z.enum(["weekly", "monthly"]),
        amountCents: positiveCents,
        alertPct: z.number().int().min(1).max(100).nullable().optional(),
        isActive: z.boolean(),
      }),
    )
    .default([]),
  savingsGoals: z
    .array(
      z.object({
        id: ref,
        name: z.string().trim().min(1).max(80),
        targetCents: positiveCents,
        targetDate: date.nullable().optional(),
        monthlyContributionCents: positiveCents.nullable().optional(),
        priority: z.number().int().min(1).max(3),
        tracking: z.enum(["manual", "account"]),
        accountId: ref.nullable().optional(),
        achievedAt: timestamp.nullable().optional(),
        archivedAt: timestamp.nullable().optional(),
        notes: text(1000).nullable().optional(),
      }),
    )
    .default([]),
  goalAllocations: z
    .array(z.object({ goalId: ref, date, amountCents: cents.refine((v) => v !== 0), note: text(200).nullable().optional() }))
    .default([]),
  purchasePlans: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        priceCents: positiveCents,
        desiredDate: date.nullable().optional(),
        priority: z.number().int().min(1).max(3),
        url: z.string().regex(/^https?:\/\//).max(500).nullable().optional(),
        notes: text(1000).nullable().optional(),
        goalId: ref.nullable().optional(),
        status: z.enum(["active", "purchased", "abandoned"]),
        deadline: date.nullable().optional(),
        project: text(60).nullable().optional(),
        accountId: ref.nullable().optional(),
        categoryId: ref.nullable().optional(),
      }),
    )
    .default([]),
});

export type ImportPayload = Record<string, unknown>;
export type ImportCounts = { accounts: number; transactions: number; rules: number; goals: number; purchases: number };
export type ParsedBackup = { ok: true; payload: ImportPayload; counts: ImportCounts } | { ok: false; error: string };

/** Vérifie une sauvegarde (objet JSON déjà décodé) et la convertit pour import_backup. */
export function parseBackup(raw: unknown): ParsedBackup {
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "format" || issue?.path[0] === "version") {
      return { ok: false, error: "Ce fichier n'est pas une sauvegarde de cette application (format ou version inconnus)." };
    }
    return { ok: false, error: `Sauvegarde invalide : ${issue?.path.join(" › ") || "contenu"} (${issue?.message ?? "erreur"}).` };
  }
  const b = parsed.data;

  // Références internes : tout identifiant cité doit exister dans la sauvegarde.
  const accounts = new Set(b.accounts.map((a) => a.id));
  const categories = new Map(b.categories.map((c) => [c.id, c.kind]));
  const rules = new Set(b.recurringRules.map((r) => r.id));
  const goals = new Set(b.savingsGoals.map((g) => g.id));
  const missing = (what: string) => ({ ok: false as const, error: `Sauvegarde incohérente : ${what} introuvable.` });
  for (const r of b.recurringRules) {
    if (!accounts.has(r.accountId) || (r.toAccountId && !accounts.has(r.toAccountId))) return missing(`compte de l'échéance « ${r.label} »`);
    if (r.categoryId && !categories.has(r.categoryId)) return missing(`catégorie de l'échéance « ${r.label} »`);
  }
  for (const t of b.transactions) {
    if (t.entries.some((e) => !accounts.has(e.accountId))) return missing(`compte de l'opération « ${t.label} »`);
    if (t.categoryId && categories.get(t.categoryId) !== t.kind) return missing(`catégorie de l'opération « ${t.label} »`);
    if (t.recurrenceId && !rules.has(t.recurrenceId)) return missing(`échéance de l'opération « ${t.label} »`);
  }
  for (const x of b.budgets) if (!categories.has(x.categoryId)) return missing("catégorie d'un budget");
  for (const g of b.savingsGoals) if (g.accountId && !accounts.has(g.accountId)) return missing(`compte de l'objectif « ${g.name} »`);
  for (const a of b.goalAllocations) if (!goals.has(a.goalId)) return missing("objectif d'une affectation");
  for (const p of b.purchasePlans) {
    if ((p.goalId && !goals.has(p.goalId)) || (p.accountId && !accounts.has(p.accountId)) || (p.categoryId && !categories.has(p.categoryId))) {
      return missing(`référence de l'achat « ${p.name} »`);
    }
  }
  const s = b.settings;
  if (s?.spendingAccountId && !accounts.has(s.spendingAccountId)) return missing("compte de dépenses courantes");

  const payload: ImportPayload = {
    accounts: b.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype ?? null,
      opening_balance_cents: a.openingBalanceCents,
      opening_balance_date: a.openingBalanceDate,
      valid_until: a.validUntil ?? null,
      institution: a.institution ?? null,
      notes: a.notes ?? null,
      archived_at: a.archivedAt ?? null,
    })),
    categories: b.categories.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      system_key: c.systemKey ?? null,
      color: c.color ?? null,
      sort_order: c.sortOrder ?? 500,
      archived_at: c.archivedAt ?? null,
    })),
    rules: b.recurringRules.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      amount_cents: r.amountCents,
      account_id: r.accountId,
      to_account_id: r.toAccountId ?? null,
      category_id: r.categoryId ?? null,
      frequency: r.frequency,
      start_date: r.startDate,
      end_date: r.endDate ?? null,
      tracking_start: r.trackingStart,
      certainty: r.certainty,
      is_active: r.isActive,
      notes: r.notes ?? null,
    })),
    transactions: b.transactions.map((t) => ({
      kind: t.kind,
      status: t.status,
      date: t.date,
      label: t.label,
      notes: t.notes ?? null,
      amount_cents: t.amountCents,
      expected_amount_cents: t.expectedAmountCents ?? null,
      category_id: t.categoryId ?? null,
      recurrence_id: t.recurrenceId ?? null,
      occurrence_date: t.recurrenceId ? (t.occurrenceDate ?? null) : null,
      is_exceptional: t.isExceptional ?? false,
      created_at: t.createdAt ?? null,
      confirmed_at: t.confirmedAt ?? null,
      entries: t.entries.map((e) => ({ account_id: e.accountId, amount_cents: e.amountCents })),
    })),
    budgets: b.budgets.map((x) => ({
      category_id: x.categoryId,
      period: x.period,
      amount_cents: x.amountCents,
      alert_pct: x.alertPct ?? null,
      is_active: x.isActive,
    })),
    goals: b.savingsGoals.map((g) => ({
      id: g.id,
      name: g.name,
      target_cents: g.targetCents,
      target_date: g.targetDate ?? null,
      monthly_contribution_cents: g.monthlyContributionCents ?? null,
      priority: g.priority,
      tracking: g.tracking,
      account_id: g.accountId ?? null,
      achieved_at: g.achievedAt ?? null,
      archived_at: g.archivedAt ?? null,
      notes: g.notes ?? null,
    })),
    allocations: b.goalAllocations.map((a) => ({ goal_id: a.goalId, date: a.date, amount_cents: a.amountCents, note: a.note ?? null })),
    purchase_plans: b.purchasePlans.map((p) => ({
      name: p.name,
      price_cents: p.priceCents,
      desired_date: p.desiredDate ?? null,
      priority: p.priority,
      url: p.url ?? null,
      notes: p.notes ?? null,
      goal_id: p.goalId ?? null,
      status: p.status,
      deadline: p.deadline ?? null,
      project: p.project ?? null,
      account_id: p.accountId ?? null,
      category_id: p.categoryId ?? null,
    })),
    settings: s
      ? {
          theme: s.theme ?? null,
          safety_reserve_cents: s.safetyReserveCents ?? null,
          budget_alert_pct: s.budgetAlertPct ?? null,
          bill_reminder_days: s.billReminderDays ?? null,
          comparison_months: s.comparisonMonths ?? null,
          forecast_include_probable: s.forecastIncludeProbable ?? null,
          preserve_budgets_in_forecast: s.preserveBudgetsInForecast ?? null,
          notify_budget_alerts: s.notifyBudgetAlerts ?? null,
          notify_upcoming_bills: s.notifyUpcomingBills ?? null,
          notify_low_balance: s.notifyLowBalance ?? null,
          spending_account_id: s.spendingAccountId ?? null,
        }
      : null,
  };

  return {
    ok: true,
    payload,
    counts: {
      accounts: b.accounts.length,
      transactions: b.transactions.length,
      rules: b.recurringRules.length,
      goals: b.savingsGoals.length,
      purchases: b.purchasePlans.length,
    },
  };
}
