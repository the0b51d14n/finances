/**
 * Schémas de validation partagés entre le navigateur (retour immédiat) et
 * le serveur (seule validation qui fait foi). Les montants sont saisis en
 * texte français (« 12,50 ») et convertis en centimes entiers.
 */
import { z } from "zod";
import { isValidIsoDate } from "@/lib/dates";
import { ACCOUNT_SUBTYPE_KEYS, subtypeType } from "@/lib/domain/account-kinds";
import { hasExpiry } from "@/lib/domain/accounts";
import { parseAmountToCents } from "@/lib/money";

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

// -----------------------------------------------------------------------------
// Tableau de bord : salaires et dépenses
// -----------------------------------------------------------------------------

/** Montant reçu pour une ligne de salaire. */
export const salarySchema = z.object({
  salary: z.enum(["alternance", "auchan"], { error: "Salaire inconnu." }),
  amount,
  client_request_id: optionalUuid,
});

/**
 * Quand : une fois (à une date), ou répété. Chaque semaine → jour de la
 * semaine (1 = lundi … 7 = dimanche) ; chaque mois → numéro du jour (1 à 31) ;
 * chaque année → date de la première échéance.
 */
const scheduleFields = {
  repeat: z.enum(["none", "weekly", "monthly", "annual"], { error: "Choisissez quand." }).default("none"),
  date: optionalDate,
  weekday: z.string().optional(),
  day: z.string().optional(),
};

type ScheduleInput = { repeat: "none" | "weekly" | "monthly" | "annual"; date: string | null; weekday?: string; day?: string };

function checkSchedule(v: ScheduleInput, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if ((v.repeat === "none" || v.repeat === "annual") && !v.date) issue("date", "Choisissez la date.");
  if (v.repeat === "weekly" && !/^[1-7]$/.test(v.weekday ?? "")) issue("weekday", "Choisissez le jour de la semaine.");
  if (v.repeat === "monthly") {
    const day = Number(v.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) issue("day", "Jour du mois : un nombre de 1 à 31.");
  }
}

/** Échéancier validé : prêt pour firstDate (src/lib/domain/recurrence.ts). */
function toSchedule(v: ScheduleInput) {
  switch (v.repeat) {
    case "weekly":
      return { repeat: "weekly", weekday: Number(v.weekday) } as const;
    case "monthly":
      return { repeat: "monthly", day: Number(v.day) } as const;
    case "annual":
      return { repeat: "annual", date: v.date! } as const;
    default:
      return { repeat: "none", date: v.date! } as const;
  }
}

/** Dépense : nom (facultatif : le domaine sinon), montant, domaine, compte qui paie et quand. */
const paymentPart = z.object({
  account_id: uuid("Choisissez chaque moyen de paiement."),
  amount_cents: z.number().int().positive("Chaque moyen de paiement doit avoir un montant positif.").max(100_000_000_000),
});

/** Autres moyens de paiement d'une dépense, transmis en JSON par le formulaire ; vide si absent. */
const paymentsField = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return [];
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Moyens de paiement illisibles." });
      return z.NEVER;
    }
  })
  .pipe(z.array(paymentPart).max(6, "6 moyens de paiement maximum."));

export const expenseSchema = z
  .object({
    label: optionalText(140),
    amount,
    category_id: uuid("Choisissez un domaine."),
    account_id: uuid("Choisissez un compte."),
    /** Autres comptes qui paient une part (carte cadeau, espèces, livret via virement…). */
    payments: paymentsField,
    client_request_id: optionalUuid,
    ...scheduleFields,
  })
  .superRefine((v, ctx) => {
    checkSchedule(v, ctx);
    if (v.payments.length === 0) return;
    const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["payments"], message });
    if (v.repeat !== "none") issue("Une dépense récurrente est payée par un seul compte.");
    if (v.payments.reduce((s, p) => s + p.amount_cents, 0) > v.amount) issue("Les autres moyens de paiement dépassent le montant de la dépense.");
    const ids = v.payments.map((p) => p.account_id);
    if (new Set(ids).size !== ids.length || ids.includes(v.account_id)) issue("Chaque compte ne peut apparaître qu'une fois (compte qui paie compris).");
  })
  .transform((v) => ({ ...v, schedule: toSchedule(v) }));

/** Virement entre deux comptes, ponctuel ou récurrent. */
export const transferSchema = z
  .object({
    amount,
    from_account_id: uuid("Choisissez le compte de départ."),
    to_account_id: uuid("Choisissez le compte d'arrivée."),
    label: optionalText(140),
    client_request_id: optionalUuid,
    ...scheduleFields,
  })
  .superRefine((v, ctx) => {
    if (v.from_account_id === v.to_account_id) {
      ctx.addIssue({ code: "custom", path: ["to_account_id"], message: "Choisissez deux comptes différents." });
    }
    checkSchedule(v, ctx);
  })
  .transform((v) => ({ ...v, schedule: toSchedule(v) }));

// -----------------------------------------------------------------------------
// Comptes
// -----------------------------------------------------------------------------

export const balanceAdjustmentSchema = z.object({
  account_id: uuid("Compte invalide."),
  observed_balance: signedAmount,
  date: isoDate,
  label: optionalText(140),
});

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
    if (v.valid_until && !hasExpiry(type)) {
      ctx.addIssue({
        code: "custom",
        path: ["valid_until"],
        message: "La date d'expiration ne concerne que les tickets-restaurant, cartes cadeaux, bons d'achat et ressources affectées.",
      });
    }
  })
  .transform((v) => {
    const type = subtypeType(v.subtype);
    return { ...v, type, opening_balance: type === "debt" ? 0 - v.opening_balance : v.opening_balance };
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
