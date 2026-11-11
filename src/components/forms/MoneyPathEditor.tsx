"use client";

import { useState, useTransition } from "react";
import { proposeMoneyPathAction } from "@/app/actions/ledger";
import { addDays, formatDate, maxDate } from "@/lib/dates";
import { formatCents, parseAmountToCents } from "@/lib/money";
import type { AccountOption } from "./options";

type Step = { from_account_id: string; to_account_id: string; amount: string; date: string };

/**
 * Chemin de l'argent d'une dépense ponctuelle : virements préalables (ex.
 * épargne → courant secondaire → courant principal), proposés par l'appli puis
 * modifiables. Envoyés avec la dépense dans le champ caché « path ».
 */
export function MoneyPathEditor({
  accounts,
  payerAccountId,
  amount,
  date,
  today,
  error,
}: {
  accounts: AccountOption[];
  payerAccountId: string;
  amount: string;
  date: string;
  today: string;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const payer = accounts.find((a) => a.id === payerAccountId);
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "?";
  const update = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((step, j) => (j === i ? { ...step, ...patch } : step)));

  const propose = () =>
    startTransition(async () => {
      const res = await proposeMoneyPathAction(payerAccountId, amount, date);
      if (!res.ok) {
        setMessage(res.error);
        return;
      }
      setSteps(res.steps);
      if (res.steps.length === 0) setMessage("Le compte qui paie suffit : aucun virement nécessaire.");
      else if (res.uncoveredCents > 0) setMessage(`Il manquera encore ${formatCents(res.uncoveredCents)} : l'épargne ne suffit pas.`);
      else setMessage(`Il manque ${formatCents(res.shortfallCents)} sur ${payer?.name ?? "le compte qui paie"}. Chemin proposé, modifiable :`);
    });

  const addStep = () =>
    setSteps((s) => [...s, { from_account_id: "", to_account_id: payerAccountId, amount: "", date: maxDate(today, addDays(date || today, -1)) }]);

  const serialized = JSON.stringify(
    steps.map((s) => ({ from_account_id: s.from_account_id, to_account_id: s.to_account_id, amount_cents: parseAmountToCents(s.amount) ?? 0, date: s.date })),
  );

  return (
    <div className="card stack-sm" style={{ background: "var(--bg-elev)" }}>
      <label className="checkbox">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        Prévoir le chemin de l&apos;argent (virements avant la dépense)
      </label>
      {open && (
        <>
          {steps.length > 0 && <input type="hidden" name="path" value={serialized} />}
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={propose} disabled={pending} aria-busy={pending}>
              {pending ? "Calcul…" : "Proposer un chemin"}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={addStep}>
              + Ajouter un virement
            </button>
          </div>
          {message && (
            <p className="small muted" role="status">
              {message}
            </p>
          )}
          {steps.map((step, i) => (
            <div key={i} className="form-grid" style={{ alignItems: "end" }}>
              <div className="field">
                <label htmlFor={`path-from-${i}`}>Virement {i + 1} : depuis</label>
                <select id={`path-from-${i}`} className="select" value={step.from_account_id} onChange={(e) => update(i, { from_account_id: e.target.value })}>
                  <option value="">Choisir…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`path-to-${i}`}>vers</label>
                <select id={`path-to-${i}`} className="select" value={step.to_account_id} onChange={(e) => update(i, { to_account_id: e.target.value })}>
                  <option value="">Choisir…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`path-amount-${i}`}>Montant (€)</label>
                <input
                  id={`path-amount-${i}`}
                  className="input"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={step.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`path-date-${i}`}>Date</label>
                <input id={`path-date-${i}`} type="date" className="input" value={step.date} onChange={(e) => update(i, { date: e.target.value })} />
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} aria-label={`Retirer le virement ${i + 1}`}>
                Retirer
              </button>
            </div>
          ))}
          {steps.length > 0 && (
            <p className="small">
              {steps.map((s) => `${nameOf(s.from_account_id)} → ${nameOf(s.to_account_id)}`).join(", ")}, puis dépense de {amount || "…"} € depuis{" "}
              {payer?.name ?? "…"}
              {date ? ` le ${formatDate(date)}` : ""}.
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
