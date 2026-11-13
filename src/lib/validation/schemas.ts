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

/** Dépense rapide : montant, domaine et compte qui paie, datée d'aujourd'hui. */
export const expenseSchema = z.object({
  amount,
  category_id: uuid("Choisissez un domaine."),
  account_id: uuid("Choisissez un compte."),
  client_request_id: optionalUuid,
});

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
