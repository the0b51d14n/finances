/**
 * Schémas de validation partagés entre le navigateur (retour immédiat) et
 * le serveur (seule validation qui fait foi). Les montants sont saisis en
 * texte français (« 12,50 ») et convertis en centimes entiers.
 */
import { z } from "zod";
import { isValidIsoDate } from "@/lib/dates";
import { ACCOUNT_SUBTYPE_KEYS, subtypeType } from "@/lib/domain/account-kinds";
import { parseAmountToCents } from "@/lib/money";

const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"] as const;

const requiredText = (max: number, label: string) =>
  z
    .string({ error: `${label} obligatoire.` })
    .trim()
    .min(1, `${label} obligatoire.`)
    .max(max, `${label} : ${max} caractères maximum.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères maximum.`)
    .optional()
    .transform((v) => (v ? v : null));

export const isoDate = z.string({ error: "Date obligatoire." }).refine(isValidIsoDate, "Date invalide.");

const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v || isValidIsoDate(v), "Date invalide.")
  .transform((v) => (v ? v : null));

/** Montant strictement positif, en centimes. */
export const amount = z.string({ error: "Montant obligatoire." }).transform((value, ctx) => {
  const cents = parseAmountToCents(value);
  if (cents === null || cents <= 0) {
    ctx.addIssue({ code: "custom", message: "Montant invalide : saisissez un nombre strictement positif (ex. 12,50)." });
    return z.NEVER;
  }
  return cents;
});

/** Montant positif ou nul ; vide = 0. */
const amountOrZero = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value || value.trim() === "") return 0;
    const cents = parseAmountToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Montant invalide (ex. 12,50)." });
      return z.NEVER;
    }
    return cents;
  });

/** Montant facultatif strictement positif ; vide = null. */
const optionalAmount = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value || value.trim() === "") return null;
    const cents = parseAmountToCents(value);
    if (cents === null || cents <= 0) {
      ctx.addIssue({ code: "custom", message: "Montant invalide : nombre strictement positif attendu." });
      return z.NEVER;
    }
    return cents;
  });

/** Montant signé (un solde peut être négatif), en centimes. */
export const signedAmount = z.string({ error: "Montant obligatoire." }).transform((value, ctx) => {
  const trimmed = value.trim();
  const negative = /^[-−]/.test(trimmed);
  const cents = parseAmountToCents(trimmed.replace(/^[-−+]\s*/, ""));
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Montant invalide (ex. 1 250,00 ou -35,20)." });
    return z.NEVER;
  }
  return negative ? -cents : cents;
});

const uuid = (message: string) => z.uuid({ error: message });

const optionalUuid = z
  .string()
  .optional()
  .refine((v) => !v || z.uuid().safeParse(v).success, "Sélection invalide.")
  .transform((v) => (v ? v : null));

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const intInRange = (min: number, max: number, label: string) =>
  z.coerce
    .number({ error: `${label} invalide.` })
    .int(`${label} : nombre entier attendu.`)
    .min(min, `${label} : minimum ${min}.`)
    .max(max, `${label} : maximum ${max}.`);

// -----------------------------------------------------------------------------
// Opérations
// -----------------------------------------------------------------------------

export const transactionSchema = z
  .object({
    id: optionalUuid,
    client_request_id: optionalUuid,
    kind: z.enum(["expense", "income", "transfer", "adjustment"], { error: "Type de mouvement invalide." }),
    status: z.enum(["planned", "confirmed", "cancelled"], { error: "Statut invalide." }).default("confirmed"),
    date: isoDate,
    label: requiredText(140, "Libellé"),
    amount,
    account_id: uuid("Choisissez un compte."),
    to_account_id: optionalUuid,
    category_id: optionalUuid,
    voucher_account_id: optionalUuid,
    voucher_amount: amountOrZero,
    direction: z.enum(["increase", "decrease"]).optional(),
    notes: optionalText(2000),
    is_exceptional: checkbox,
    recurrence_id: optionalUuid,
    occurrence_date: optionalDate,
    expected_amount: optionalAmount,
    repeat: z.enum(["none", ...FREQUENCIES]).default("none"),
    /** Achat planifié réalisé par cette opération (marqué « acheté » après enregistrement). */
    purchase_plan_id: optionalUuid,
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if ((v.kind === "expense" || v.kind === "income") && !v.category_id) issue("category_id", "Choisissez une catégorie.");
    if (v.kind === "transfer") {
      if (!v.to_account_id) issue("to_account_id", "Choisissez le compte destinataire.");
      else if (v.to_account_id === v.account_id) issue("to_account_id", "Les comptes source et destinataire doivent être différents.");
    }
    if (v.kind === "adjustment" && !v.direction) issue("direction", "Indiquez le sens de l'ajustement.");
    if (v.kind === "expense" && v.voucher_amount > 0) {
      if (!v.voucher_account_id) issue("voucher_account_id", "Choisissez le portefeuille de tickets-restaurant.");
      if (v.voucher_amount > v.amount) issue("voucher_amount", "La part en tickets dépasse le montant total.");
    }
    if (v.repeat !== "none") {
      if (v.kind === "adjustment") issue("repeat", "Un ajustement ne peut pas être récurrent.");
      if (v.voucher_amount > 0) issue("repeat", "Une opération récurrente ne peut pas être payée en tickets-restaurant.");
      if (v.recurrence_id) issue("repeat", "Cette opération est déjà liée à une récurrence.");
    }
    if (!!v.recurrence_id !== !!v.occurrence_date) issue("occurrence_date", "Échéance de récurrence incomplète.");
  });

export type TransactionInput = z.output<typeof transactionSchema>;

export const balanceAdjustmentSchema = z.object({
  account_id: uuid("Compte invalide."),
  observed_balance: signedAmount,
  date: isoDate,
  label: optionalText(140),
});

// -----------------------------------------------------------------------------
// Comptes et catégories
// -----------------------------------------------------------------------------

export const accountSchema = z
  .object({
    id: optionalUuid,
    name: requiredText(80, "Nom"),
    subtype: z.enum(ACCOUNT_SUBTYPE_KEYS, { error: "Type de compte invalide." }),
    /** Pour une dette : montant restant dû, saisi positif et enregistré négatif. */
    opening_balance: signedAmount,
    opening_balance_date: isoDate,
    valid_until: optionalDate,
    institution: optionalText(60),
    notes: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    const type = subtypeType(v.subtype);
    if ((type === "cash" || type === "meal_voucher" || type === "earmarked") && v.opening_balance < 0) {
      ctx.addIssue({ code: "custom", path: ["opening_balance"], message: "Ce type de compte ne peut pas avoir un solde négatif." });
    }
    if (type === "debt" && v.opening_balance < 0) {
      ctx.addIssue({ code: "custom", path: ["opening_balance"], message: "Saisissez le montant restant dû en positif." });
    }
    if (v.valid_until && type !== "meal_voucher") {
      ctx.addIssue({ code: "custom", path: ["valid_until"], message: "La validité ne concerne que les tickets-restaurant." });
    }
  })
  .transform((v) => {
    const type = subtypeType(v.subtype);
    return { ...v, type, opening_balance: type === "debt" ? 0 - v.opening_balance : v.opening_balance };
  });

export const categorySchema = z.object({
  id: optionalUuid,
  kind: z.enum(["expense", "income"], { error: "Type invalide." }),
  name: requiredText(60, "Nom"),
  color: z
    .string()
    .optional()
    .refine((v) => !v || /^#[0-9a-fA-F]{6}$/.test(v), "Couleur invalide.")
    .transform((v) => (v ? v : null)),
});

// -----------------------------------------------------------------------------
// Récurrences
// -----------------------------------------------------------------------------

export const ruleSchema = z
  .object({
    id: optionalUuid,
    kind: z.enum(["expense", "income", "transfer"], { error: "Type invalide." }),
    label: requiredText(140, "Libellé"),
    amount,
    account_id: uuid("Choisissez un compte."),
    to_account_id: optionalUuid,
    category_id: optionalUuid,
    frequency: z.enum(FREQUENCIES, { error: "Fréquence invalide." }),
    start_date: isoDate,
    end_date: optionalDate,
    tracking_start: optionalDate,
    certainty: z.enum(["certain", "probable", "uncertain"]).default("certain"),
    is_active: checkbox,
    notes: optionalText(1000),
    apply_from: optionalDate,
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.kind !== "transfer" && !v.category_id) issue("category_id", "Choisissez une catégorie.");
    if (v.kind === "transfer") {
      if (!v.to_account_id) issue("to_account_id", "Choisissez le compte destinataire.");
      else if (v.to_account_id === v.account_id) issue("to_account_id", "Les comptes doivent être différents.");
    }
    if (v.end_date && v.end_date < v.start_date) issue("end_date", "La date de fin précède la date de début.");
    if (v.apply_from && v.apply_from <= v.start_date) issue("apply_from", "La date d'application doit suivre la date de début.");
  });

export type RuleInput = z.output<typeof ruleSchema>;

// -----------------------------------------------------------------------------
// Budgets, objectifs, achats, paramètres
// -----------------------------------------------------------------------------

export const budgetSchema = z.object({
  id: optionalUuid,
  category_id: uuid("Choisissez une catégorie."),
  period: z.enum(["weekly", "monthly"], { error: "Période invalide." }),
  amount,
  alert_pct: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        ctx.addIssue({ code: "custom", message: "Seuil entre 1 et 100 %." });
        return z.NEVER;
      }
      return n;
    }),
  is_active: checkbox,
});

export const goalSchema = z
  .object({
    id: optionalUuid,
    name: requiredText(80, "Nom"),
    target: amount,
    target_date: optionalDate,
    monthly_contribution: optionalAmount,
    priority: intInRange(1, 3, "Priorité"),
    tracking: z.enum(["manual", "account"], { error: "Mode de suivi invalide." }),
    account_id: optionalUuid,
    notes: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.tracking === "account" && !v.account_id) {
      ctx.addIssue({ code: "custom", path: ["account_id"], message: "Choisissez le compte dont le solde mesure l'objectif." });
    }
  });

export const allocationSchema = z.object({
  goal_id: uuid("Objectif invalide."),
  date: isoDate,
  amount,
  direction: z.enum(["add", "remove"]).default("add"),
  note: optionalText(200),
});

export const purchasePlanSchema = z
  .object({
    id: optionalUuid,
    name: requiredText(120, "Nom"),
    price: amount,
    desired_date: optionalDate,
    deadline: optionalDate,
    priority: intInRange(1, 3, "Priorité"),
    project: optionalText(60),
    account_id: optionalUuid,
    category_id: optionalUuid,
    url: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || (/^https?:\/\//.test(v) && v.length <= 500), "Lien invalide (http:// ou https://).")
      .transform((v) => (v ? v : null)),
    notes: optionalText(1000),
    goal_id: optionalUuid,
  })
  .superRefine((v, ctx) => {
    if (v.deadline && v.desired_date && v.deadline < v.desired_date) {
      ctx.addIssue({ code: "custom", path: ["deadline"], message: "La date limite précède la date « pas avant »." });
    }
  });

export const settingsSchema = z.object({
  theme: z.enum(["dark", "light", "system"]),
  safety_reserve: amountOrZero,
  budget_alert_pct: intInRange(1, 100, "Seuil d'alerte"),
  bill_reminder_days: intInRange(1, 60, "Rappel des échéances"),
  comparison_months: intInRange(2, 24, "Nombre de mois comparés"),
  forecast_include_probable: checkbox,
  preserve_budgets_in_forecast: checkbox,
  notify_budget_alerts: checkbox,
  notify_upcoming_bills: checkbox,
  notify_low_balance: checkbox,
  spending_account_id: optionalUuid,
});

// -----------------------------------------------------------------------------
// Outils
// -----------------------------------------------------------------------------

export type FieldErrors = Partial<Record<string, string>>;

export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Valeurs texte d'un FormData (les fichiers sont ignorés). */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") out[key] = value;
  return out;
}
