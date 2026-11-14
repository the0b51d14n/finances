"use client";

import { useEffect, useRef, useState } from "react";
import { addExpenseAction, addSalaryAction, addTransferAction } from "@/app/actions/ledger";
import { FormMessage, useServerForm } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { formatCents, parseAmountToCents } from "@/lib/money";
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
/** Compte d'une liste de choix (voir accountChoices) : libellé « nom · nature · solde », groupe = banque. */
type AccountOption = Option & { label: string; group: string; viaTransfer: boolean; hubName?: string | null };
type PaymentOption = AccountOption;

/** Comptes regroupés par banque, pour s'y retrouver entre plusieurs moyens de paiement. */
function AccountOptions({ options }: { options: AccountOption[] }) {
  const groups = new Map<string, AccountOption[]>();
  for (const o of options) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
  return [...groups.entries()].map(([group, list]) => (
    <optgroup key={group} label={group}>
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {o.viaTransfer ? `${o.label} (par virement)` : o.label}
        </option>
      ))}
    </optgroup>
  ));
}
type PaymentRow = { key: number; accountId: string; amount: string };

/**
 * Autres moyens de paiement d'une dépense (carte cadeau, espèces, livret…) :
 * chacun règle sa part, le compte qui paie règle le reste. Un livret passe
 * par un virement vers le compte qui paie. Envoyé en JSON (champ « payments »).
 */
function PaymentsEditor({
  options,
  rows,
  onChange,
  totalCents,
  mainName,
}: {
  options: PaymentOption[];
  rows: PaymentRow[];
  onChange: (rows: PaymentRow[]) => void;
  totalCents: number | null;
  mainName: string;
}) {
  const parts = rows
    .map((r) => ({ account_id: r.accountId, amount_cents: parseAmountToCents(r.amount) ?? 0 }))
    .filter((p) => p.account_id && p.amount_cents > 0);
  const othersCents = parts.reduce((s, p) => s + p.amount_cents, 0);
  const update = (key: number, patch: Partial<PaymentRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="stack-sm">
      <input type="hidden" name="payments" value={parts.length > 0 ? JSON.stringify(parts) : ""} />
      {rows.map((r, i) => {
        const option = options.find((o) => o.id === r.accountId);
        return (
          <div key={r.key} className={styles.payment}>
            <div className="field">
              <label htmlFor={`payment-account-${r.key}`}>{`Autre moyen de paiement ${i + 1}`}</label>
              <select id={`payment-account-${r.key}`} className="select" value={r.accountId} onChange={(e) => update(r.key, { accountId: e.target.value })}>
                <option value="" disabled>
                  Choisir…
                </option>
                <AccountOptions options={options} />
              </select>
            </div>
            <div className="field">
              <label htmlFor={`payment-amount-${r.key}`}>Montant</label>
              <input
                id={`payment-amount-${r.key}`}
                className="input num"
                inputMode="decimal"
                placeholder="0,00"
                value={r.amount}
                onChange={(e) => update(r.key, { amount: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              aria-label={`Retirer le moyen de paiement ${i + 1}`}
            >
              <Icon name="x" size={16} />
            </button>
            {option?.viaTransfer && (
              <span className={`faint tiny ${styles.paymentNote}`}>
                Virement {[option.name, ...(option.hubName && option.hubName !== mainName ? [option.hubName] : []), mainName].join(" → ")}, puis paiement.
              </span>
            )}
          </div>
        );
      })}
      <div className="row-between">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...rows, { key: Date.now(), accountId: "", amount: "" }])}>
          <Icon name="plus" size={14} /> Autre moyen de paiement
        </button>
        {rows.length > 0 && totalCents !== null && (
          <span className={totalCents - othersCents < 0 ? "neg small" : "muted small"}>
            {mainName} : {formatCents(totalCents - othersCents)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Dépense affichée dans le calendrier. Prévue : une fois ou récurrente (« Quand »).
 * Non prévue (onglet Opérations, `unplanned`) : déjà faite, à une date passée ou du jour.
 */
export function ExpenseForm({
  categories,
  accounts,
  defaultAccountId,
  today,
  paymentAccounts = [],
  unplanned = false,
}: {
  categories: Option[];
  accounts: AccountOption[];
  defaultAccountId: string;
  today: string;
  /** Autres moyens de paiement proposés (dépense non prévue uniquement). */
  paymentAccounts?: PaymentOption[];
  unplanned?: boolean;
}) {
  const { state, pending, onSubmit, errors } = useServerForm(addExpenseAction, { schema: expenseSchema });
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [amount, setAmount] = useState("");
  const [mainId, setMainId] = useState(defaultAccountId);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const ref = useResetOnSuccess(state.status, () => {
    setRepeat("none");
    setAmount("");
    setMainId(defaultAccountId);
    setPayments([]);
  });
  const fieldError =
    errors.label ?? errors.amount ?? errors.category_id ?? errors.account_id ?? errors.payments ?? errors.date ?? errors.weekday ?? errors.day;
  return (
    <form ref={ref} onSubmit={onSubmit} className="stack-sm" noValidate>
      <div className={styles.grid}>
        <div className="field">
          <label htmlFor="expense-label">Nom</label>
          <input
            id="expense-label"
            name="label"
            className="input"
            maxLength={140}
            placeholder={unplanned ? "Ex. Courses Lidl, Facture élec" : "Ex. Loyer, Abonnement"}
            aria-invalid={!!errors.label}
          />
        </div>
        <div className="field">
          <label htmlFor="expense-amount">Montant</label>
          <input
            id="expense-amount"
            name="amount"
            className="input num"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!!errors.amount}
            required
          />
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
          <label htmlFor="expense-account">{unplanned ? "Compte qui paie" : "Compte"}</label>
          <select
            id="expense-account"
            name="account_id"
            className="select"
            value={mainId}
            onChange={(e) => setMainId(e.target.value)}
            aria-invalid={!!errors.account_id}
            required
          >
            <AccountOptions options={accounts} />
          </select>
        </div>
        {unplanned ? (
          <div className="field">
            <input type="hidden" name="repeat" value="none" />
            <label htmlFor="expense-date">Date</label>
            <input id="expense-date" name="date" type="date" className="input" defaultValue={today} max={today} aria-invalid={!!errors.date} required />
          </div>
        ) : (
          <ScheduleFields prefix="expense" today={today} repeat={repeat} onRepeat={setRepeat} errors={errors} />
        )}
      </div>
      {unplanned && (
        <PaymentsEditor
          options={paymentAccounts.filter((o) => o.id !== mainId)}
          rows={payments}
          onChange={setPayments}
          totalCents={parseAmountToCents(amount)}
          mainName={accounts.find((a) => a.id === mainId)?.name ?? "Compte qui paie"}
        />
      )}
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
export function TransferForm({ accounts, today }: { accounts: AccountOption[]; today: string }) {
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
            <AccountOptions options={accounts} />
          </select>
        </div>
        <div className="field">
          <label htmlFor="transfer-to">Vers</label>
          <select id="transfer-to" name="to_account_id" className="select" defaultValue="" aria-invalid={!!errors.to_account_id} required>
            <option value="" disabled>
              Choisir…
            </option>
            <AccountOptions options={accounts} />
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
