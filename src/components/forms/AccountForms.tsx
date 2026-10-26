"use client";

import { useState } from "react";
import { adjustBalanceAction, saveAccountAction } from "@/app/actions/ledger";
import { Field, FormMessage, useServerForm } from "@/components/ui/forms";
import { ACCOUNT_KIND_GROUPS, ACCOUNT_SUBTYPES, type AccountSubtype, subtypeType } from "@/lib/domain/account-kinds";
import { ACCOUNT_CLASS_LABELS, accountClass } from "@/lib/domain/accounts";
import type { AccountType } from "@/lib/domain/types";
import { formatCents } from "@/lib/money";
import { accountSchema, balanceAdjustmentSchema } from "@/lib/validation/schemas";

/** Ce que le type implique pour les calculs, affiché sous le choix du type. */
const TYPE_HELP: Record<AccountType, string> = {
  checking: "Compté dans l'argent disponible. Un découvert se traduit par un solde négatif de ce compte : pas de compte séparé.",
  cash: "Compté dans l'argent disponible.",
  savings: "Compté dans l'épargne et le total, pas dans l'argent disponible.",
  dedicated_savings: "Compté dans l'épargne et le total, pas dans l'argent disponible.",
  other: "Compté dans le total, pas dans l'argent disponible.",
  investment:
    "Valeur fluctuante, comptée dans le total mais pas dans l'argent disponible. Mettez la valeur à jour depuis la page du compte : la variation n'est ni un revenu ni une dépense.",
  debt: "Jamais compté comme de l'argent. Un remboursement se saisit comme un transfert depuis votre compte courant ; les intérêts et frais comme une dépense.",
  meal_voucher: "Ressource affectée : ni dans l'argent disponible ni dans le total des soldes.",
  earmarked: "Ressource affectée : ni dans l'argent disponible ni dans le total. Elle sert à payer des dépenses, sans transfert possible.",
};

export type AccountFormValues = {
  id?: string;
  name: string;
  subtype: AccountSubtype;
  openingBalance: string;
  openingBalanceDate: string;
  validUntil: string;
  institution: string;
  notes: string;
};

export function AccountForm({
  initial,
  openingLocked,
  institutions = [],
}: {
  initial: AccountFormValues;
  openingLocked: boolean;
  /** Banques déjà saisies, proposées en suggestion. */
  institutions?: string[];
}) {
  const { state, pending, onSubmit, errors } = useServerForm(saveAccountAction, { schema: accountSchema });
  const [subtype, setSubtype] = useState<AccountSubtype>(initial.subtype);
  const type = subtypeType(subtype);
  const openingLabel = type === "debt" ? "Montant restant dû (€)" : type === "investment" ? "Valeur initiale (€)" : "Solde initial (€)";
  const openingHint = openingLocked
    ? "Compte déjà utilisé : corrigez le solde par un ajustement."
    : type === "debt"
      ? "Montant positif au début du jour de référence, enregistré comme une dette."
      : type === "checking" || type === "savings" || type === "other"
        ? "Solde au début du jour de référence. Négatif possible (découvert)."
        : "Solde au début du jour de référence.";

  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="form-grid">
        <Field id="name" label="Nom du compte" error={errors.name}>
          <input id="name" name="name" className="input" maxLength={80} defaultValue={initial.name} placeholder="Ex. Compte courant" required />
        </Field>
        <Field id="subtype" label="Type de compte" error={errors.subtype} hint={`Classe : ${ACCOUNT_CLASS_LABELS[accountClass(type)]}`}>
          <select id="subtype" name="subtype" className="select" value={subtype} onChange={(e) => setSubtype(e.target.value as AccountSubtype)}>
            {ACCOUNT_KIND_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {ACCOUNT_SUBTYPES[kind].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field id="institution" label="Banque (facultatif)" error={errors.institution} hint="Sert à regrouper vos comptes.">
          <input
            id="institution"
            name="institution"
            className="input"
            maxLength={60}
            defaultValue={initial.institution}
            placeholder="Ex. Caisse d'Épargne"
            list="institutions-list"
            autoComplete="off"
          />
          <datalist id="institutions-list">
            {institutions.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="form-grid">
        <Field id="opening_balance" label={openingLabel} error={errors.opening_balance} hint={openingHint}>
          <input
            id="opening_balance"
            name="opening_balance"
            className="input num"
            inputMode="decimal"
            defaultValue={initial.openingBalance}
            readOnly={openingLocked}
            required
          />
        </Field>
        <Field
          id="opening_balance_date"
          label="Date de référence"
          error={errors.opening_balance_date}
          hint="Les opérations antérieures à cette date n'affectent pas le solde."
        >
          <input
            id="opening_balance_date"
            name="opening_balance_date"
            type="date"
            className="input"
            defaultValue={initial.openingBalanceDate}
            readOnly={openingLocked}
            required
          />
        </Field>
      </div>
      {type === "meal_voucher" && (
        <Field id="valid_until" label="Validité des tickets (facultatif)" error={errors.valid_until}>
          <input id="valid_until" name="valid_until" type="date" className="input" defaultValue={initial.validUntil} />
        </Field>
      )}
      <p className="faint small">{TYPE_HELP[type]}</p>
      <Field id="notes" label="Notes (facultatif)" error={errors.notes}>
        <textarea id="notes" name="notes" className="textarea" maxLength={1000} defaultValue={initial.notes} />
      </Field>
      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : initial.id ? "Enregistrer" : "Créer le compte"}
        </button>
      </div>
    </form>
  );
}

/** Correction traçable : l'utilisateur saisit le solde réellement constaté. */
export function AdjustBalanceForm({ accountId, currentCents }: { accountId: string; currentCents: number }) {
  const { state, pending, onSubmit, errors } = useServerForm(adjustBalanceAction, {
    schema: balanceAdjustmentSchema.omit({ date: true }),
    withRequestId: true,
  });
  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      <input type="hidden" name="account_id" value={accountId} />
      <p className="small muted">
        Solde calculé : <strong className="num">{formatCents(currentCents)}</strong>. Si votre banque affiche un autre montant, saisissez-le : une
        opération d&apos;ajustement datée d&apos;aujourd&apos;hui enregistrera l&apos;écart.
      </p>
      <div className="form-grid">
        <Field id="observed_balance" label="Solde constaté (€)" error={errors.observed_balance}>
          <input id="observed_balance" name="observed_balance" className="input num" inputMode="decimal" placeholder="Ex. 1 234,56" required />
        </Field>
        <Field id="adj_label" label="Libellé (facultatif)" error={errors.label}>
          <input id="adj_label" name="label" className="input" maxLength={140} placeholder="Ajustement de solde" />
        </Field>
      </div>
      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer l'ajustement"}
        </button>
      </div>
    </form>
  );
}
