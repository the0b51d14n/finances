"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure, success, type ActionState } from "@/lib/actions/state";
import { dbErrorMessage } from "@/lib/data/errors";
import { getSession } from "@/lib/data/session";
import { categorySchema, fieldErrorsOf, formValues, settingsSchema } from "@/lib/validation/schemas";

const INVALID = "Vérifiez les champs signalés.";

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = settingsSchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { supabase, userId } = await getSession();
  const { error } = await supabase
    .from("user_settings")
    .update({
      theme: v.theme,
      safety_reserve_cents: v.safety_reserve,
      budget_alert_pct: v.budget_alert_pct,
      bill_reminder_days: v.bill_reminder_days,
      comparison_months: v.comparison_months,
      forecast_include_probable: v.forecast_include_probable,
      preserve_budgets_in_forecast: v.preserve_budgets_in_forecast,
      notify_budget_alerts: v.notify_budget_alerts,
      notify_upcoming_bills: v.notify_upcoming_bills,
      notify_low_balance: v.notify_low_balance,
      spending_account_id: v.spending_account_id,
    })
    .eq("user_id", userId);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success("Paramètres enregistrés.");
}

export async function saveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = categorySchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { supabase } = await getSession();
  // Le type d'une catégorie existante n'est jamais modifié (cohérence de l'historique).
  const { error } = v.id
    ? await supabase.from("categories").update({ name: v.name, color: v.color }).eq("id", v.id)
    : await supabase.from("categories").insert({ kind: v.kind, name: v.name, color: v.color, sort_order: 500 });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(v.id ? "Catégorie renommée." : "Catégorie ajoutée.");
}

export async function archiveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const archive = formData.get("archive") === "1";
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("categories")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", String(formData.get("id") ?? ""));
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(archive ? "Catégorie archivée (l'historique est conservé)." : "Catégorie réactivée.");
}

export async function deleteCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await getSession();
  const { error } = await supabase.from("categories").delete().eq("id", String(formData.get("id") ?? ""));
  if (error) return failure(dbErrorMessage(error, "delete_category"));
  refreshAll();
  return success("Catégorie supprimée.");
}

/** Suppression définitive de toutes les données financières (confirmation saisie). */
export async function deleteAllDataAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const confirmation = String(formData.get("confirmation") ?? "");
  if (confirmation !== "SUPPRIMER") return failure("Saisissez SUPPRIMER en majuscules pour confirmer.");
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("delete_all_my_data", { p_confirmation: confirmation });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect("/");
}
