/**
 * Traduction des erreurs de base de données en messages compréhensibles.
 * Seul le code d'erreur est journalisé (jamais les données saisies).
 */
type DbError = { code?: string; message?: string; details?: string | null } | null | undefined;

const KNOWN: [RegExp, string][] = [
  [/ledger_unbalanced/, "Les écritures de l'opération sont incohérentes : vérifiez les montants et les comptes."],
  [/meal_voucher_transfer/, "Les tickets-restaurant et avantages affectés ne peuvent pas être transférés vers ou depuis un autre compte."],
  [/confirmed_in_future/, "Une opération confirmée ne peut pas être datée dans le futur : enregistrez-la comme « prévue »."],
  [/account_archived/, "Ce compte est archivé : il ne peut plus recevoir de nouvelles opérations."],
  [/transaction_not_found|rule_not_found/, "Élément introuvable ou inaccessible."],
  [/not_authenticated/, "Votre session a expiré : reconnectez-vous."],
  [/confirmation_required/, "Confirmation manquante."],
  [/recurrence_id_occurrence_date/, "Cette échéance a déjà été enregistrée."],
  [/categories_user_kind_name_uniq/, "Une catégorie de ce type porte déjà ce nom."],
  [/budgets_user_id_category_id_period_key/, "Un budget existe déjà pour cette catégorie et cette période."],
];

export function dbErrorMessage(error: DbError, context?: "delete_account" | "delete_category"): string {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  for (const [pattern, message] of KNOWN) if (pattern.test(text)) return message;
  if (error?.code === "23503") {
    if (context === "delete_account") return "Ce compte est utilisé par des opérations, règles ou objectifs : archivez-le plutôt.";
    if (context === "delete_category") return "Cette catégorie est utilisée : archivez-la plutôt.";
    return "Cet élément est référencé ailleurs et ne peut pas être modifié ainsi.";
  }
  if (error?.code === "23505") return "Cet élément existe déjà.";
  if (error?.code === "23514") return "Les données saisies ne respectent pas les règles de cohérence.";
  if (error?.code === "42501") return "Accès refusé.";
  console.error(`[base de données] erreur non gérée (${error?.code ?? "inconnue"})`);
  return "Une erreur est survenue. Vérifiez votre connexion puis réessayez.";
}
