/**
 * Natures de comptes proposées à la saisie, regroupées par famille.
 *
 * La nature est descriptive (Livret A, PEA, crédit immobilier…) ; c'est le type
 * associé qui détermine le comportement comptable : classe, sens du solde,
 * transferts autorisés. La correspondance nature → type est revérifiée par la
 * contrainte SQL accounts_subtype_check.
 *
 * Pas de nature « découvert » : un découvert est le solde négatif d'un compte
 * courant ; un compte séparé le compterait deux fois.
 */
import type { Account, AccountType } from "./types";

export const ACCOUNT_SUBTYPES = {
  // Comptes bancaires → argent disponible
  current: { label: "Compte courant", type: "checking" },
  joint: { label: "Compte joint", type: "checking" },
  secondary: { label: "Compte bancaire secondaire", type: "checking" },
  professional: { label: "Compte professionnel", type: "checking" },
  online_payment: { label: "Compte de paiement en ligne (PayPal…)", type: "checking" },
  mobile_payment: { label: "Compte de paiement mobile", type: "checking" },
  // Espèces et moyens de paiement
  cash: { label: "Espèces", type: "cash" },
  meal_voucher: { label: "Tickets-restaurant", type: "meal_voucher" },
  gift_card: { label: "Carte cadeau", type: "earmarked" },
  prepaid_card: { label: "Carte prépayée", type: "cash" },
  e_wallet: { label: "Portefeuille électronique", type: "cash" },
  store_credit: { label: "Avoirs et bons d'achat", type: "earmarked" },
  // Épargne
  savings_account: { label: "Livret d'épargne", type: "savings" },
  livret_a: { label: "Livret A", type: "savings" },
  ldds: { label: "LDDS", type: "savings" },
  lep: { label: "LEP", type: "savings" },
  livret_jeune: { label: "Livret Jeune", type: "savings" },
  pel: { label: "PEL (plan épargne logement)", type: "savings" },
  cel: { label: "CEL (compte épargne logement)", type: "savings" },
  term_deposit: { label: "Compte à terme", type: "savings" },
  goal_savings: { label: "Épargne spécifique (objectif personnel)", type: "dedicated_savings" },
  other_reserve: { label: "Autre réserve", type: "other" },
  // Placements et investissements → valeur fluctuante
  cto: { label: "Compte-titres ordinaire (CTO)", type: "investment" },
  pea: { label: "PEA", type: "investment" },
  life_insurance: { label: "Assurance-vie", type: "investment" },
  per: { label: "PER (plan épargne retraite)", type: "investment" },
  crypto: { label: "Crypto-actifs", type: "investment" },
  stocks_etf: { label: "Actions et ETF", type: "investment" },
  bonds: { label: "Obligations", type: "investment" },
  crowdfunding: { label: "Financement participatif", type: "investment" },
  // Crédits et dettes → solde négatif (montant restant dû)
  mortgage: { label: "Crédit immobilier", type: "debt" },
  consumer_loan: { label: "Crédit à la consommation", type: "debt" },
  student_loan: { label: "Prêt étudiant", type: "debt" },
  personal_debt: { label: "Dette personnelle à rembourser", type: "debt" },
  // Ressources et avantages complémentaires
  online_kitty: { label: "Cagnotte en ligne", type: "other" },
  cashback: { label: "Solde d'application de remboursement (cashback)", type: "other" },
  transport_credit: { label: "Titres de transport prépayés", type: "earmarked" },
  holiday_vouchers: { label: "Chèques-vacances", type: "earmarked" },
  employee_benefits: { label: "Compte d'avantages salariés", type: "earmarked" },
  custom: { label: "Autre compte personnalisé", type: "other" },
} as const satisfies Record<string, { label: string; type: AccountType }>;

export type AccountSubtype = keyof typeof ACCOUNT_SUBTYPES;

export const ACCOUNT_SUBTYPE_KEYS = Object.keys(ACCOUNT_SUBTYPES) as [AccountSubtype, ...AccountSubtype[]];

export const ACCOUNT_KIND_GROUPS: { label: string; kinds: AccountSubtype[] }[] = [
  { label: "Comptes bancaires", kinds: ["current", "joint", "secondary", "professional", "online_payment", "mobile_payment"] },
  { label: "Espèces et moyens de paiement", kinds: ["cash", "meal_voucher", "gift_card", "prepaid_card", "e_wallet", "store_credit"] },
  {
    label: "Épargne",
    kinds: ["savings_account", "livret_a", "ldds", "lep", "livret_jeune", "pel", "cel", "term_deposit", "goal_savings", "other_reserve"],
  },
  { label: "Placements et investissements", kinds: ["cto", "pea", "life_insurance", "per", "crypto", "stocks_etf", "bonds", "crowdfunding"] },
  { label: "Crédits et dettes", kinds: ["mortgage", "consumer_loan", "student_loan", "personal_debt"] },
  {
    label: "Ressources et avantages complémentaires",
    kinds: ["online_kitty", "cashback", "transport_credit", "holiday_vouchers", "employee_benefits", "custom"],
  },
];

/** Nature attribuée aux comptes créés avant l'introduction des natures. */
export const DEFAULT_SUBTYPE: Record<AccountType, AccountSubtype> = {
  checking: "current",
  cash: "cash",
  savings: "savings_account",
  dedicated_savings: "goal_savings",
  other: "other_reserve",
  meal_voucher: "meal_voucher",
  investment: "cto",
  debt: "personal_debt",
  earmarked: "gift_card",
};

export function subtypeType(subtype: AccountSubtype): AccountType {
  return ACCOUNT_SUBTYPES[subtype].type;
}

export function accountSubtype(account: Pick<Account, "type" | "subtype">): AccountSubtype {
  return account.subtype && ACCOUNT_SUBTYPES[account.subtype]?.type === account.type ? account.subtype : DEFAULT_SUBTYPE[account.type];
}

export function accountKindLabel(account: Pick<Account, "type" | "subtype">): string {
  return ACCOUNT_SUBTYPES[accountSubtype(account)].label;
}
