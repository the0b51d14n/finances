"use client";

import { useEffect, useRef } from "react";
import { addExpenseAction, addSalaryAction } from "@/app/actions/ledger";
import { FormMessage, useServerForm } from "@/components/ui/forms";
import { expenseSchema, salarySchema } from "@/lib/validation/schemas";
import styles from "./dashboard-forms.module.css";

/** Vide le formulaire après un enregistrement réussi (prêt pour la saisie suivante). */
function useResetOnSuccess(status: string) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (status === "success") ref.current?.reset();
  }, [status]);
  return ref;
}

/** Ligne de salaire : le montant reçu crédite le compte courant secondaire. */
export function SalaryForm({ salary, label }: { salary: string; label: string }) {
  const { state, pending, onSubmit, errors } = useServerForm(addSalaryAction, { schema: salarySchema });
  const ref = useResetOnSuccess(state.status);
  const id = `salary-${salary}`;
  return (
    <form ref={ref} onSubmit={onSubmit} className="stack-sm" noValidate>
      <input type="hidden" name="salary" value={salary} />
      <div className={styles.inline}>
        <label htmlFor={id} className="visually-hidden">
          Montant reçu : {label}
        </label>
        <input
          id={id}
          name="amount"
          className="input num"
          inputMode="decimal"
          placeholder="Montant reçu"
          aria-invalid={!!errors.amount}
          required
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Ajouter"}
        </button>
      </div>
      {errors.amount ? <span className="field-error">{errors.amount}</span> : <FormMessage state={state} />}
    </form>
  );
}

type Option = { id: string; name: string };

/** Dépense rapide, datée d'aujourd'hui : alimente le graphique des dépenses par domaine. */
export function ExpenseForm({ categories, accounts, defaultAccountId }: { categories: Option[]; accounts: Option[]; defaultAccountId: string }) {
  const { state, pending, onSubmit, errors } = useServerForm(addExpenseAction, { schema: expenseSchema });
  const ref = useResetOnSuccess(state.status);
  const fieldError = errors.amount ?? errors.category_id ?? errors.account_id;
  return (
    <form ref={ref} onSubmit={onSubmit} className="stack-sm" noValidate>
      <div className={styles.expense}>
        <div className="field">
          <label htmlFor="expense-amount">Montant</label>
          <input id="expense-amount" name="amount" className="input num" inputMode="decimal" placeholder="0,00" aria-invalid={!!errors.amount} required />
        </div>
        <div className="field">
          <label htmlFor="expense-category">Domaine</label>
          <select id="expense-category" name="category_id" className="select" defaultValue="" aria-invalid={!!errors.category_id} required>
            <option value="" disabled>
              Choisir…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="expense-account">Compte</label>
          <select id="expense-account" name="account_id" className="select" defaultValue={defaultAccountId} aria-invalid={!!errors.account_id} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Ajouter"}
        </button>
      </div>
      {fieldError ? <span className="field-error">{fieldError}</span> : <FormMessage state={state} />}
    </form>
  );
}
