"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure, safeReturnTo, success, type ActionState } from "@/lib/actions/state";
import { dbErrorMessage } from "@/lib/data/errors";
import { getSession } from "@/lib/data/session";
import {
  allocationSchema,
  budgetSchema,
  fieldErrorsOf,
  formValues,
  goalSchema,
  purchasePlanSchema,
} from "@/lib/validation/schemas";

const INVALID = "Vérifiez les champs signalés.";

function refreshAll() {
  revalidatePath("/", "layout");
}

// -----------------------------------------------------------------------------
// Budgets
// -----------------------------------------------------------------------------

export async function saveBudgetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = budgetSchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { supabase } = await getSession();
  const row = { category_id: v.category_id, period: v.period, amount_cents: v.amount, alert_pct: v.alert_pct, is_active: v.is_active };
  const { error } = v.id
    ? await supabase.from("budgets").update(row).eq("id", v.id)
    : await supabase.from("budgets").insert(row);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect("/budget");
}

export async function deleteBudgetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await getSession();
  const { error } = await supabase.from("budgets").delete().eq("id", String(formData.get("id") ?? ""));
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success("Budget supprimé.");
}

// -----------------------------------------------------------------------------
// Objectifs d'épargne
// -----------------------------------------------------------------------------

export async function saveGoalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = goalSchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { supabase } = await getSession();
  const row = {
    name: v.name,
    target_cents: v.target,
    target_date: v.target_date,
    monthly_contribution_cents: v.monthly_contribution,
    priority: v.priority,
    tracking: v.tracking,
    account_id: v.account_id,
    notes: v.notes,
  };
  let goalId = v.id;
  if (v.id) {
    const { error } = await supabase.from("savings_goals").update(row).eq("id", v.id);
    if (error) return failure(dbErrorMessage(error));
  } else {
    const { data, error } = await supabase.from("savings_goals").insert(row).select("id").single();
    if (error || !data) return failure(dbErrorMessage(error));
    goalId = String(data.id);
  }
  refreshAll();
  redirect(`/objectifs/${goalId}`);
}

export async function setGoalStateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  const on = formData.get("value") === "1";
  if (field !== "achieved_at" && field !== "archived_at") return failure("Action invalide.");
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("savings_goals")
    .update({ [field]: on ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  if (field === "achieved_at") return success(on ? "Objectif marqué comme atteint." : "Objectif rouvert.");
  return success(on ? "Objectif archivé." : "Objectif réactivé.");
}

export async function deleteGoalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await getSession();
  const { error } = await supabase.from("savings_goals").delete().eq("id", String(formData.get("id") ?? ""));
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect("/objectifs");
}

/** Affectation (ou désaffectation) d'une somme déjà présente sur les comptes à un objectif. */
export async function addAllocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = allocationSchema.safeParse(formValues(formData));
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { supabase } = await getSession();
  const { error } = await supabase.from("goal_allocations").insert({
    goal_id: v.goal_id,
    date: v.date,
    amount_cents: v.direction === "remove" ? -v.amount : v.amount,
    note: v.note,
  });
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(v.direction === "remove" ? "Somme désaffectée." : "Somme affectée à l'objectif.");
}

export async function deleteAllocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await getSession();
  const { error } = await supabase.from("goal_allocations").delete().eq("id", String(formData.get("id") ?? ""));
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success("Affectation supprimée.");
}

// -----------------------------------------------------------------------------
// Achats envisagés
// -----------------------------------------------------------------------------

export async function savePurchasePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = purchasePlanSchema.safeParse(values);
  if (!parsed.success) return failure(INVALID, fieldErrorsOf(parsed.error));
  const v = parsed.data;
  const { supabase } = await getSession();
  const row = {
    name: v.name,
    price_cents: v.price,
    desired_date: v.desired_date,
    priority: v.priority,
    url: v.url,
    notes: v.notes,
    goal_id: v.goal_id,
    deadline: v.deadline,
    project: v.project,
    account_id: v.account_id,
    category_id: v.category_id,
  };
  let planId = v.id;
  if (v.id) {
    const { error } = await supabase.from("purchase_plans").update(row).eq("id", v.id);
    if (error) return failure(dbErrorMessage(error));
  } else {
    const { data, error } = await supabase.from("purchase_plans").insert(row).select("id").single();
    if (error || !data) return failure(dbErrorMessage(error));
    planId = String(data.id);
  }
  refreshAll();
  redirect(safeReturnTo(values.return_to, `/achats#achat-${planId}`));
}

export async function setPurchaseStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const status = String(formData.get("status") ?? "");
  if (!["active", "purchased", "abandoned"].includes(status)) return failure("Statut invalide.");
  const { supabase } = await getSession();
  const { error } = await supabase.from("purchase_plans").update({ status }).eq("id", String(formData.get("id") ?? ""));
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  return success(status === "purchased" ? "Achat marqué comme effectué : pensez à saisir la dépense." : "Statut mis à jour.");
}

export async function deletePurchasePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await getSession();
  const { error } = await supabase.from("purchase_plans").delete().eq("id", String(formData.get("id") ?? ""));
  if (error) return failure(dbErrorMessage(error));
  refreshAll();
  redirect("/previsions");
}
