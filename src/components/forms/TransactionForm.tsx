"use client";

import { useState } from "react";
import { saveTransactionAction } from "@/app/actions/ledger";
import { Field, FormMessage, useServerForm } from "@/components/ui/forms";
import { FREQUENCY_LABELS } from "@/lib/domain/recurrence";
import type { TransactionKind, TransactionStatus } from "@/lib/domain/types";
import { transactionSchema } from "@/lib/validation/schemas";
import type { AccountOption, CategoryOption } from "./options";

export type TransactionFormValues = {
  id?: string;
  kind: TransactionKind;
  status: TransactionStatus;
  date: string;
  label: string;
  amount: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  voucherAccountId: string;
  voucherAmount: string;
  direction: "increase" | "decrease";
  notes: string;
  isExceptional: boolean;
  recurrenceId?: string | null;
  occurrenceDate?: string | null;
  expectedAmount?: string;
  /** Achat planifié réalisé par cette dépense. */
  purchasePlanId?: string | null;
};

const KIND_OPTIONS: { value: TransactionKind; label: string }[] = [
  { value: "expense", label: "Dépense" },
  { value: "income", label: "Revenu" },
  { value: "transfer", label: "Transfert" },
  { value: "adjustment", label: "Ajustement" },
];

export function TransactionForm({
  accounts,
  categories,
  today,
  initial,
  returnTo,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
  initial: TransactionFormValues;
  returnTo?: string;
}) {
  const { state, pending, onSubmit, errors } = useServerForm(saveTransactionAction, { schema: transactionSchema, withRequestId: !initial.id });
  const [kind, setKind] = useState<TransactionKind>(initial.kind);
  const [status, setStatus] = useState<TransactionStatus>(initial.status);
  const [accountId, setAccountId] = useState(initial.accountId);
  const [useVouchers, setUseVouchers] = useState(Number(initial.voucherAmount.replace(",", ".")) > 0);

  const editing = !!initial.id;
  const usable = (a: AccountOption) => !a.archived || a.id === initial.accountId || a.id === initial.toAccountId || a.id === initial.voucherAccountId;
  const voucherAccounts = accounts.filter((a) => a.type === "meal_voucher" && usable(a));
  const sourceAccounts = accounts.filter((a) => usable(a) && (kind !== "transfer" || a.type !== "meal_voucher"));
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const kindCategories = categories.filter((c) => c.kind === kind && (!c.archived || c.id === initial.categoryId));
  const err = (name: string) => errors[name];

  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {initial.recurrenceId && <input type="hidden" name="recurrence_id" value={initial.recurrenceId} />}
      {initial.occurrenceDate && <input type="hidden" name="occurrence_date" value={initial.occurrenceDate} />}
      {initial.expectedAmount && <input type="hidden" name="expected_amount" value={initial.expectedAmount} />}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      {initial.purchasePlanId && <input type="hidden" name="purchase_plan_id" value={initial.purchasePlanId} />}

      <fieldset>
        <legend className="visually-hidden">Type de mouvement</legend>
        <div className="segmented">
          {KIND_OPTIONS.map((o) => (
            <label key={o.value}>
              <input type="radio" name="kind" value={o.value} checked={kind === o.value} onChange={() => setKind(o.value)} disabled={editing && !!initial.recurrenceId} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      {editing && initial.recurrenceId && <input type="hidden" name="kind" value={kind} />}

      <div className="form-grid">
        <Field id="amount" label="Montant (€)" error={err("amount")} hint="Toujours positif : le type détermine le sens.">
          <input
            id="amount"
            name="amount"
            className="input input-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            defaultValue={initial.amount}
            aria-invalid={!!err("amount")}
            autoFocus={!editing}
            required
          />
        </Field>
        <Field id="label" label="Libellé" error={err("label")}>
          <input id="label" name="label" className="input" maxLength={140} defaultValue={initial.label} aria-invalid={!!err("label")} required />
        </Field>
      </div>

      <div className="form-grid">
        <Field id="date" label="Date" error={err("date")}>
          <input
            id="date"
            name="date"
            type="date"
            className="input"
            defaultValue={initial.date}
            aria-invalid={!!err("date")}
            onChange={(e) => {
              if (e.target.value > today && status === "confirmed") setStatus("planned");
            }}
            required
          />
        </Field>
        <Field id="status" label="Statut" hint={status === "planned" ? "Non comptée dans les soldes tant qu'elle n'est pas confirmée." : undefined}>
          <select id="status" name="status" className="select" value={status} onChange={(e) => setStatus(e.target.value as TransactionStatus)}>
            <option value="confirmed">Confirmée (effectuée)</option>
            <option value="planned">Prévue</option>
            {editing && <option value="cancelled">Annulée</option>}
          </select>
        </Field>
      </div>

      <div className="form-grid">
        <Field id="account_id" label={kind === "transfer" ? "Depuis le compte" : kind === "income" ? "Compte crédité" : "Compte"} error={err("account_id")}>
          <select
            id="account_id"
            name="account_id"
            className="select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-invalid={!!err("account_id")}
            required
          >
            <option value="">Choisir…</option>
            {sourceAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.archived ? " (archivé)" : ""}
              </option>
            ))}
          </select>
        </Field>

        {kind === "transfer" && (
          <Field id="to_account_id" label="Vers le compte" error={err("to_account_id")}>
            <select id="to_account_id" name="to_account_id" className="select" defaultValue={initial.toAccountId} aria-invalid={!!err("to_account_id")}>
              <option value="">Choisir…</option>
              {sourceAccounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
        )}

        {(kind === "expense" || kind === "income") && (
          <Field id="category_id" label="Catégorie" error={err("category_id")}>
            <select id="category_id" name="category_id" className="select" defaultValue={initial.categoryId} aria-invalid={!!err("category_id")}>
              <option value="">Choisir…</option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {kind === "adjustment" && (
          <Field id="direction" label="Sens de la correction" error={err("direction")} hint="Préférez l'ajustement depuis la page du compte (saisie du solde constaté).">
            <select id="direction" name="direction" className="select" defaultValue={initial.direction}>
              <option value="increase">Augmenter le solde</option>
              <option value="decrease">Diminuer le solde</option>
            </select>
          </Field>
        )}
      </div>

      {kind === "expense" && voucherAccounts.length > 0 && selectedAccount?.type !== "meal_voucher" && (
        <div className="card stack-sm" style={{ background: "var(--bg-elev)" }}>
          <label className="checkbox">
            <input type="checkbox" checked={useVouchers} onChange={(e) => setUseVouchers(e.target.checked)} />
            Payée en partie avec des tickets-restaurant
          </label>
          {useVouchers && (
            <div className="form-grid">
              <Field id="voucher_account_id" label="Portefeuille de tickets" error={err("voucher_account_id")}>
                <select id="voucher_account_id" name="voucher_account_id" className="select" defaultValue={initial.voucherAccountId || voucherAccounts[0]?.id}>
                  {voucherAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="voucher_amount" label="Part payée en tickets (€)" error={err("voucher_amount")} hint="Le reste est débité du compte choisi.">
                <input id="voucher_amount" name="voucher_amount" className="input" inputMode="decimal" defaultValue={initial.voucherAmount} placeholder="0,00" />
              </Field>
            </div>
          )}
        </div>
      )}

      {!editing && kind !== "adjustment" && !initial.recurrenceId && (
        <Field id="repeat" label="Récurrence" error={err("repeat")} hint="Crée aussi l'échéance récurrente, visible dans le calendrier.">
          <select id="repeat" name="repeat" className="select" defaultValue="none">
            <option value="none">Ne pas répéter</option>
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {kind === "expense" && (
        <label className="checkbox">
          <input type="checkbox" name="is_exceptional" defaultChecked={initial.isExceptional} />
          Dépense exceptionnelle (signalée à part dans les analyses)
        </label>
      )}

      <Field id="notes" label="Notes (facultatif)" error={err("notes")}>
        <textarea id="notes" name="notes" className="textarea" maxLength={2000} defaultValue={initial.notes} />
      </Field>

      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
          {pending ? "Enregistrement…" : editing ? "Enregistrer les modifications" : "Enregistrer l'opération"}
        </button>
      </div>
    </form>
  );
}
