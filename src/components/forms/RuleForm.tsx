"use client";

import { useState } from "react";
import { saveRuleAction } from "@/app/actions/ledger";
import { Field, FormMessage, useServerForm } from "@/components/ui/forms";
import { isTransferable } from "@/lib/domain/accounts";
import { FREQUENCY_LABELS } from "@/lib/domain/recurrence";
import type { Certainty, Frequency } from "@/lib/domain/types";
import { CERTAINTY_HINTS, CERTAINTY_LABELS } from "@/lib/view/labels";
import { ruleSchema } from "@/lib/validation/schemas";
import type { AccountOption, CategoryOption } from "./options";

export type RuleFormValues = {
  id?: string;
  kind: "expense" | "income" | "transfer";
  label: string;
  amount: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  frequency: Frequency;
  startDate: string;
  endDate: string;
  trackingStart: string;
  certainty: Certainty;
  isActive: boolean;
  notes: string;
};

export function RuleForm({
  accounts,
  categories,
  initial,
  returnTo,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  initial: RuleFormValues;
  returnTo?: string;
}) {
  const { state, pending, onSubmit, errors } = useServerForm(saveRuleAction, { schema: ruleSchema });
  const [kind, setKind] = useState(initial.kind);
  const [certainty, setCertainty] = useState<Certainty>(initial.certainty);
  const editing = !!initial.id;
  const usable = accounts.filter((a) => !a.archived || a.id === initial.accountId || a.id === initial.toAccountId);
  const transferable = usable.filter((a) => isTransferable(a.type));
  const kindCategories = categories.filter((c) => c.kind === kind && (!c.archived || c.id === initial.categoryId));

  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <fieldset>
        <legend className="visually-hidden">Type</legend>
        <div className="segmented">
          {(
            [
              ["expense", "Dépense"],
              ["income", "Revenu / aide"],
              ["transfer", "Transfert"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="form-grid">
        <Field id="label" label="Libellé" error={errors.label}>
          <input id="label" name="label" className="input" maxLength={140} defaultValue={initial.label} placeholder="Ex. Loyer, Salaire, APL" required />
        </Field>
        <Field id="amount" label="Montant estimé (€)" error={errors.amount} hint="Le montant réel pourra être ajusté à la confirmation.">
          <input id="amount" name="amount" className="input input-amount" inputMode="decimal" defaultValue={initial.amount} placeholder="0,00" required />
        </Field>
      </div>

      <div className="form-grid">
        <Field id="account_id" label={kind === "transfer" ? "Depuis le compte" : kind === "income" ? "Compte crédité" : "Compte débité"} error={errors.account_id}>
          <select id="account_id" name="account_id" className="select" defaultValue={initial.accountId}>
            <option value="">Choisir…</option>
            {(kind === "transfer" ? transferable : usable).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        {kind === "transfer" ? (
          <Field id="to_account_id" label="Vers le compte" error={errors.to_account_id}>
            <select id="to_account_id" name="to_account_id" className="select" defaultValue={initial.toAccountId}>
              <option value="">Choisir…</option>
              {transferable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field id="category_id" label="Catégorie" error={errors.category_id}>
            <select id="category_id" name="category_id" className="select" defaultValue={initial.categoryId}>
              <option value="">Choisir…</option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="form-grid">
        <Field id="frequency" label="Fréquence" error={errors.frequency}>
          <select id="frequency" name="frequency" className="select" defaultValue={initial.frequency}>
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="start_date" label="Première échéance" error={errors.start_date} hint="Les échéances suivantes gardent ce jour du mois.">
          <input id="start_date" name="start_date" type="date" className="input" defaultValue={initial.startDate} required />
        </Field>
        <Field id="end_date" label="Fin (facultatif)" error={errors.end_date}>
          <input id="end_date" name="end_date" type="date" className="input" defaultValue={initial.endDate} />
        </Field>
      </div>

      {kind !== "expense" && (
        <Field id="certainty" label="Certitude" hint={CERTAINTY_HINTS[certainty]}>
          <select id="certainty" name="certainty" className="select" value={certainty} onChange={(e) => setCertainty(e.target.value as Certainty)}>
            {Object.entries(CERTAINTY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {kind === "expense" && <input type="hidden" name="certainty" value="certain" />}

      <details className="disclosure">
        <summary>Options avancées</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <Field
            id="tracking_start"
            label="Suivre les échéances à partir du"
            error={errors.tracking_start}
            hint="Les échéances antérieures sont réputées incluses dans vos soldes initiaux et ne seront jamais « à confirmer »."
          >
            <input id="tracking_start" name="tracking_start" type="date" className="input" defaultValue={initial.trackingStart} />
          </Field>
          {editing && (
            <Field
              id="apply_from"
              label="Appliquer ces modifications seulement à partir du (facultatif)"
              error={errors.apply_from}
              hint="La règle actuelle s'arrête la veille et une nouvelle prend le relais : l'historique reste intact."
            >
              <input id="apply_from" name="apply_from" type="date" className="input" />
            </Field>
          )}
          <Field id="notes" label="Notes" error={errors.notes}>
            <textarea id="notes" name="notes" className="textarea" maxLength={1000} defaultValue={initial.notes} />
          </Field>
        </div>
      </details>

      {editing ? (
        <label className="checkbox">
          <input type="checkbox" name="is_active" defaultChecked={initial.isActive} />
          Récurrence active
        </label>
      ) : (
        <input type="hidden" name="is_active" value="on" />
      )}

      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : editing ? "Enregistrer" : "Créer l'échéance récurrente"}
        </button>
      </div>
    </form>
  );
}
