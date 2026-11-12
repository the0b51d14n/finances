"use client";

import { useState } from "react";
import { formatCents, parseAmountToCents } from "@/lib/money";
import type { AccountOption } from "./options";

export type PaymentRow = { accountId: string; amount: string };

/**
 * Dépense payée avec plusieurs moyens de paiement (carte cadeau, bon d'achat,
 * tickets-restaurant, espèces…) : chaque moyen paie sa part, le compte
 * principal paie le reste. Envoyé dans le champ caché « payments » (JSON).
 */
export function PaymentsEditor({
  accounts,
  mainAccountId,
  amount,
  initial,
  error,
}: {
  /** Moyens utilisables (le compte principal est exclu de la liste proposée). */
  accounts: AccountOption[];
  mainAccountId: string;
  amount: string;
  initial: PaymentRow[];
  error?: string;
}) {
  const [open, setOpen] = useState(initial.length > 0);
  const [rows, setRows] = useState<PaymentRow[]>(initial.length > 0 ? initial : [{ accountId: "", amount: "" }]);

  const choices = accounts.filter((a) => a.id !== mainAccountId);
  const mainName = accounts.find((a) => a.id === mainAccountId)?.name ?? "le compte choisi";
  const update = (i: number, patch: Partial<PaymentRow>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const filled = rows.filter((r) => r.accountId && r.amount.trim());
  const othersCents = filled.reduce((s, r) => s + (parseAmountToCents(r.amount) ?? 0), 0);
  const totalCents = parseAmountToCents(amount) ?? 0;
  const restCents = totalCents - othersCents;
  const serialized = JSON.stringify(filled.map((r) => ({ account_id: r.accountId, amount_cents: parseAmountToCents(r.amount) ?? 0 })));

  return (
    <div className="card stack-sm" style={{ background: "var(--bg-elev)" }}>
      <label className="checkbox">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        Payée avec plusieurs moyens de paiement (carte cadeau, bon d&apos;achat, tickets, espèces…)
      </label>
      {open && (
        <>
          {filled.length > 0 && <input type="hidden" name="payments" value={serialized} />}
          {rows.map((row, i) => (
            <div key={i} className="form-grid" style={{ alignItems: "end" }}>
              <div className="field">
                <label htmlFor={`payment-account-${i}`}>Moyen de paiement {i + 1}</label>
                <select id={`payment-account-${i}`} className="select" value={row.accountId} onChange={(e) => update(i, { accountId: e.target.value })}>
                  <option value="">Choisir…</option>
                  {choices.map((a) => (
                    <option key={a.id} value={a.id} disabled={rows.some((r, j) => j !== i && r.accountId === a.id)}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`payment-amount-${i}`}>Part payée (€)</label>
                <input
                  id={`payment-amount-${i}`}
                  className="input"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={row.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [{ accountId: "", amount: "" }]))}
                aria-label={`Retirer le moyen de paiement ${i + 1}`}
              >
                Retirer
              </button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRows((r) => [...r, { accountId: "", amount: "" }])}>
              + Ajouter un moyen de paiement
            </button>
          </div>
          {totalCents > 0 && filled.length > 0 && (
            <p className="small" style={{ margin: 0 }}>
              {restCents > 0
                ? `Reste ${formatCents(restCents)} payé par ${mainName}.`
                : restCents === 0
                  ? "Entièrement payée par ces moyens de paiement."
                  : `Les parts dépassent le montant de ${formatCents(-restCents)}.`}
            </p>
          )}
          {error && (
            <span className="field-error" role="alert">
              {error}
            </span>
          )}
        </>
      )}
    </div>
  );
}
