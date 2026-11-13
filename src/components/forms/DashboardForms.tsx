"use client";

import { useEffect, useRef, useState } from "react";
import { addExpenseAction, addSalaryAction, addTransferAction } from "@/app/actions/ledger";
import { FormMessage, useServerForm } from "@/components/ui/forms";
import type { FieldErrors } from "@/lib/validation/schemas";
import { expenseSchema, salarySchema, transferSchema } from "@/lib/validation/schemas";
import styles from "./dashboard-forms.module.css";

/** Vide le formulaire après un enregistrement réussi (prêt pour la saisie suivante). */
function useResetOnSuccess(status: string, onReset?: () => void) {
  const ref = useRef<HTMLFormElement>(null);
  const reset = useRef(onReset);
  useEffect(() => {
    reset.current = onReset;
  });
  useEffect(() => {
    if (status !== "success") return;
    ref.current?.reset();
    reset.current?.();
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

type Repeat = "none" | "weekly" | "monthly" | "annual";

const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/**
 * Quand : une fois (date), chaque semaine (jour de la semaine), chaque mois
 * (numéro du jour) ou chaque année (date). Pas de report des week-ends ni des
 * jours fériés : l'échéance tombe au jour choisi.
 */
function ScheduleFields({ prefix, today, repeat, onRepeat, errors }: { prefix: string; today: string; repeat: Repeat; onRepeat: (r: Repeat) => void; errors: FieldErrors }) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-repeat`}>Quand</label>
        <select id={`${prefix}-repeat`} name="repeat" className="select" value={repeat} onChange={(e) => onRepeat(e.target.value as Repeat)}>
          <option value="none">Une fois</option>
          <option value="weekly">Chaque semaine</option>
          <option value="monthly">Chaque mois</option>
          <option value="annual">Chaque année</option>
        </select>
      </div>
      {(repeat === "none" || repeat === "annual") && (
        <div className="field">
          <label htmlFor={`${prefix}-date`}>{repeat === "none" ? "Date" : "Première date"}</label>
          <input id={`${prefix}-date`} name="date" type="date" className="input" defaultValue={today} aria-invalid={!!errors.date} required />
        </div>
      )}
      {repeat === "weekly" && (
        <div className="field">
          <label htmlFor={`${prefix}-weekday`}>Jour</label>
          <select id={`${prefix}-weekday`} name="weekday" className="select" defaultValue="" aria-invalid={!!errors.weekday} required>
            <option value="" disabled>
              Choisir…
            </option>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
      {repeat === "monthly" && (
        <div className="field">
          <label htmlFor={`${prefix}-day`}>Le (jour du mois)</label>
          <input id={`${prefix}-day`} name="day" className="input num" inputMode="numeric" placeholder="1 à 31" aria-invalid={!!errors.day} required />
        </div>
      )}
    </>
  );
}

type Option = { id: string; name: string };

/** Dépense, une fois ou récurrente : alimente le calendrier et le graphique des dépenses par domaine. */
export function ExpenseForm({ categories, accounts, defaultAccountId, today }: { categories: Option[]; accounts: Option[]; defaultAccountId: string; today: string }) {
  const { state, pending, onSubmit, errors } = useServerForm(addExpenseAction, { schema: expenseSchema });
  const [repeat, setRepeat] = useState<Repeat>("none");
  const ref = useResetOnSuccess(state.status, () => setRepeat("none"));
  const fieldError = errors.label ?? errors.amount ?? errors.category_id ?? errors.account_id ?? errors.date ?? errors.weekday ?? errors.day;
  return (
    <form ref={ref} onSubmit={onSubmit} className="stack-sm" noValidate>
      <div className={styles.grid}>
        <div className="field">
          <label htmlFor="expense-label">Nom</label>
          <input id="expense-label" name="label" className="input" maxLength={140} placeholder="Ex. Loyer, Courses Lidl" aria-invalid={!!errors.label} />
        </div>
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
        <ScheduleFields prefix="expense" today={today} repeat={repeat} onRepeat={setRepeat} errors={errors} />
      </div>
      <div className="row-between">
        {fieldError ? <span className="field-error">{fieldError}</span> : <FormMessage state={state} />}
        <button type="submit" className="btn btn-primary" disabled={pending} style={{ marginLeft: "auto" }}>
          {pending ? "Enregistrement…" : "Ajouter la dépense"}
        </button>
      </div>
    </form>
  );
}

/** Virement entre deux comptes, une fois ou récurrent. */
export function TransferForm({ accounts, today }: { accounts: Option[]; today: string }) {
  const { state, pending, onSubmit, errors } = useServerForm(addTransferAction, { schema: transferSchema });
  const [repeat, setRepeat] = useState<Repeat>("none");
  const ref = useResetOnSuccess(state.status, () => setRepeat("none"));
  const fieldError = errors.amount ?? errors.from_account_id ?? errors.to_account_id ?? errors.date ?? errors.weekday ?? errors.day ?? errors.label;
  return (
    <form ref={ref} onSubmit={onSubmit} className="stack-sm" noValidate>
      <div className={styles.grid}>
        <div className="field">
          <label htmlFor="transfer-amount">Montant</label>
          <input id="transfer-amount" name="amount" className="input num" inputMode="decimal" placeholder="0,00" aria-invalid={!!errors.amount} required />
        </div>
        <div className="field">
          <label htmlFor="transfer-from">De</label>
          <select id="transfer-from" name="from_account_id" className="select" defaultValue="" aria-invalid={!!errors.from_account_id} required>
            <option value="" disabled>
              Choisir…
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="transfer-to">Vers</label>
          <select id="transfer-to" name="to_account_id" className="select" defaultValue="" aria-invalid={!!errors.to_account_id} required>
            <option value="" disabled>
              Choisir…
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <ScheduleFields prefix="transfer" today={today} repeat={repeat} onRepeat={setRepeat} errors={errors} />
        <div className="field">
          <label htmlFor="transfer-label">Libellé (facultatif)</label>
          <input id="transfer-label" name="label" className="input" maxLength={140} placeholder="Virement" />
        </div>
      </div>
      <div className="row-between">
        {fieldError ? <span className="field-error">{fieldError}</span> : <FormMessage state={state} />}
        <button type="submit" className="btn btn-primary" disabled={pending} style={{ marginLeft: "auto" }}>
          {pending ? "Enregistrement…" : "Faire le virement"}
        </button>
      </div>
    </form>
  );
}
