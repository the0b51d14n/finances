"use client";

import { useState } from "react";
import { addAllocationAction, saveBudgetAction, saveGoalAction, savePurchasePlanAction } from "@/app/actions/planning";
import { Field, FormMessage, useServerForm } from "@/components/ui/forms";
import { allocationSchema, budgetSchema, goalSchema, purchasePlanSchema } from "@/lib/validation/schemas";
import type { AccountOption, CategoryOption } from "./options";

const PRIORITIES = [
  ["1", "Haute"],
  ["2", "Normale"],
  ["3", "Basse"],
] as const;

// -----------------------------------------------------------------------------

export type BudgetFormValues = { id?: string; categoryId: string; period: "weekly" | "monthly"; amount: string; alertPct: string; isActive: boolean };

export function BudgetForm({ categories, initial, defaultAlertPct }: { categories: CategoryOption[]; initial: BudgetFormValues; defaultAlertPct: number }) {
  const { state, pending, onSubmit, errors } = useServerForm(saveBudgetAction, { schema: budgetSchema });
  const options = categories.filter((c) => c.kind === "expense" && (!c.archived || c.id === initial.categoryId));
  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="form-grid">
        <Field id="category_id" label="Catégorie de dépenses" error={errors.category_id}>
          <select id="category_id" name="category_id" className="select" defaultValue={initial.categoryId}>
            <option value="">Choisir…</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="period" label="Période" error={errors.period} hint="Semaine du lundi au dimanche, ou mois calendaire.">
          <select id="period" name="period" className="select" defaultValue={initial.period}>
            <option value="weekly">Hebdomadaire</option>
            <option value="monthly">Mensuel</option>
          </select>
        </Field>
      </div>
      <div className="form-grid">
        <Field id="amount" label="Montant prévu (€)" error={errors.amount}>
          <input id="amount" name="amount" className="input input-amount" inputMode="decimal" defaultValue={initial.amount} placeholder="0,00" />
        </Field>
        <Field id="alert_pct" label="Alerte à partir de (%)" error={errors.alert_pct} hint={`Vide = réglage général (${defaultAlertPct} %).`}>
          <input id="alert_pct" name="alert_pct" className="input" inputMode="numeric" defaultValue={initial.alertPct} placeholder={String(defaultAlertPct)} />
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" name="is_active" defaultChecked={initial.isActive} />
        Budget actif
      </label>
      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : initial.id ? "Enregistrer" : "Créer le budget"}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------

export type GoalFormValues = {
  id?: string;
  name: string;
  target: string;
  targetDate: string;
  monthlyContribution: string;
  priority: string;
  tracking: "manual" | "account";
  accountId: string;
  notes: string;
};

export function GoalForm({ accounts, initial }: { accounts: AccountOption[]; initial: GoalFormValues }) {
  const { state, pending, onSubmit, errors } = useServerForm(saveGoalAction, { schema: goalSchema });
  const [tracking, setTracking] = useState(initial.tracking);
  const options = accounts.filter((a) => a.type !== "meal_voucher" && (!a.archived || a.id === initial.accountId));
  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="form-grid">
        <Field id="name" label="Nom de l'objectif" error={errors.name}>
          <input id="name" name="name" className="input" maxLength={80} defaultValue={initial.name} placeholder="Ex. Épargne de sécurité" />
        </Field>
        <Field id="target" label="Montant cible (€)" error={errors.target}>
          <input id="target" name="target" className="input input-amount" inputMode="decimal" defaultValue={initial.target} placeholder="0,00" />
        </Field>
      </div>
      <div className="form-grid">
        <Field id="target_date" label="Date cible (facultatif)" error={errors.target_date}>
          <input id="target_date" name="target_date" type="date" className="input" defaultValue={initial.targetDate} />
        </Field>
        <Field id="monthly_contribution" label="Contribution mensuelle prévue (€)" error={errors.monthly_contribution} hint="Sert à estimer la date d'atteinte.">
          <input id="monthly_contribution" name="monthly_contribution" className="input" inputMode="decimal" defaultValue={initial.monthlyContribution} />
        </Field>
        <Field id="priority" label="Priorité" error={errors.priority}>
          <select id="priority" name="priority" className="select" defaultValue={initial.priority}>
            {PRIORITIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="stack-sm">
        <legend className="field-label">Mesure du montant accumulé</legend>
        <div className="segmented">
          <label>
            <input type="radio" name="tracking" value="manual" checked={tracking === "manual"} onChange={() => setTracking("manual")} />
            Affectations manuelles
          </label>
          <label>
            <input type="radio" name="tracking" value="account" checked={tracking === "account"} onChange={() => setTracking("account")} />
            Solde d&apos;un compte dédié
          </label>
        </div>
        <span className="field-hint">
          {tracking === "manual"
            ? "Vous réservez des sommes déjà présentes sur vos comptes : elles ne s'ajoutent jamais aux soldes."
            : "L'objectif suit le solde du compte choisi (par exemple un livret dédié)."}
        </span>
      </fieldset>
      <Field id="account_id" label={tracking === "account" ? "Compte dédié" : "Compte où se trouve l'argent (facultatif)"} error={errors.account_id}>
        <select id="account_id" name="account_id" className="select" defaultValue={initial.accountId}>
          <option value="">{tracking === "account" ? "Choisir…" : "Aucun en particulier"}</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="notes" label="Notes (facultatif)" error={errors.notes}>
        <textarea id="notes" name="notes" className="textarea" maxLength={1000} defaultValue={initial.notes} />
      </Field>
      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : initial.id ? "Enregistrer" : "Créer l'objectif"}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------

export function AllocationForm({ goalId, today }: { goalId: string; today: string }) {
  const { state, pending, onSubmit, errors } = useServerForm(addAllocationAction, { schema: allocationSchema });
  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      <input type="hidden" name="goal_id" value={goalId} />
      <div className="segmented">
        <label>
          <input type="radio" name="direction" value="add" defaultChecked />
          Affecter
        </label>
        <label>
          <input type="radio" name="direction" value="remove" />
          Désaffecter
        </label>
      </div>
      <div className="form-grid">
        <Field id="alloc_amount" label="Montant (€)" error={errors.amount}>
          <input id="alloc_amount" name="amount" className="input num" inputMode="decimal" placeholder="0,00" />
        </Field>
        <Field id="alloc_date" label="Date" error={errors.date}>
          <input id="alloc_date" name="date" type="date" className="input" defaultValue={today} />
        </Field>
      </div>
      <Field id="alloc_note" label="Note (facultatif)" error={errors.note}>
        <input id="alloc_note" name="note" className="input" maxLength={200} />
      </Field>
      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------

export type PurchaseFormValues = {
  id?: string;
  name: string;
  price: string;
  desiredDate: string;
  priority: string;
  url: string;
  notes: string;
  goalId: string;
  deadline: string;
  project: string;
  accountId: string;
  categoryId: string;
};

export function PurchaseForm({
  goals,
  initial,
  returnTo,
  accounts = [],
  categories = [],
  projects = [],
}: {
  goals: { id: string; name: string }[];
  initial: PurchaseFormValues;
  returnTo?: string;
  accounts?: AccountOption[];
  categories?: CategoryOption[];
  projects?: string[];
}) {
  const payers = accounts.filter((a) => !a.archived && (a.type === "checking" || a.type === "cash"));
  const expenseCategories = categories.filter((c) => c.kind === "expense" && (!c.archived || c.id === initial.categoryId));
  const { state, pending, onSubmit, errors } = useServerForm(savePurchasePlanAction, { schema: purchasePlanSchema });
  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <div className="form-grid">
        <Field id="p_name" label="Achat envisagé" error={errors.name}>
          <input id="p_name" name="name" className="input" maxLength={120} defaultValue={initial.name} placeholder="Ex. Ordinateur portable" />
        </Field>
        <Field id="p_price" label="Prix (€)" error={errors.price}>
          <input id="p_price" name="price" className="input input-amount" inputMode="decimal" defaultValue={initial.price} placeholder="0,00" />
        </Field>
      </div>
      <div className="form-grid">
        <Field id="p_date" label="Pas avant le (facultatif)" error={errors.desired_date} hint="Ex. date de remise des clés.">
          <input id="p_date" name="desired_date" type="date" className="input" defaultValue={initial.desiredDate} />
        </Field>
        <Field id="p_deadline" label="Date limite (facultatif)" error={errors.deadline} hint="Au plus tard ce jour-là.">
          <input id="p_deadline" name="deadline" type="date" className="input" defaultValue={initial.deadline} />
        </Field>
        <Field id="p_project" label="Projet (facultatif)" error={errors.project}>
          <input
            id="p_project"
            name="project"
            className="input"
            maxLength={60}
            defaultValue={initial.project}
            placeholder="Ex. Emménagement"
            list="projects-list"
            autoComplete="off"
          />
          <datalist id="projects-list">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="form-grid">
        {payers.length > 0 && (
          <Field id="p_account" label="Payé depuis" error={errors.account_id}>
            <select id="p_account" name="account_id" className="select" defaultValue={initial.accountId}>
              <option value="">Compte de dépenses par défaut</option>
              {payers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {expenseCategories.length > 0 && (
          <Field id="p_category" label="Catégorie de la dépense" error={errors.category_id}>
            <select id="p_category" name="category_id" className="select" defaultValue={initial.categoryId}>
              <option value="">À choisir lors de l&apos;achat</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="p_priority" label="Priorité" error={errors.priority}>
          <select id="p_priority" name="priority" className="select" defaultValue={initial.priority}>
            {PRIORITIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field id="p_goal" label="Objectif d'épargne associé" error={errors.goal_id}>
          <select id="p_goal" name="goal_id" className="select" defaultValue={initial.goalId}>
            <option value="">Aucun</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id="p_url" label="Lien (facultatif)" error={errors.url}>
        <input id="p_url" name="url" type="url" className="input" defaultValue={initial.url} placeholder="https://" />
      </Field>
      <Field id="p_notes" label="Notes (facultatif)" error={errors.notes}>
        <textarea id="p_notes" name="notes" className="textarea" maxLength={1000} defaultValue={initial.notes} />
      </Field>
      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : initial.id ? "Enregistrer" : "Ajouter à la liste d'achats"}
        </button>
      </div>
    </form>
  );
}
