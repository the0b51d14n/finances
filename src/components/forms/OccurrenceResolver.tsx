"use client";

import { resolveOccurrenceAction } from "@/app/actions/ledger";
import { ActionButton, useServerForm } from "@/components/ui/forms";

/**
 * Confirme une échéance récurrente (date et montant réels, éventuellement
 * différents de l'estimation) ou l'ignore. Une échéance ne peut être
 * enregistrée qu'une fois (contrainte d'unicité en base).
 */
export function OccurrenceResolver({
  ruleId,
  occurrenceDate,
  amount,
  today,
}: {
  ruleId: string;
  occurrenceDate: string;
  amount: string;
  today: string;
}) {
  const { state, pending, onSubmit } = useServerForm(resolveOccurrenceAction);
  const defaultDate = occurrenceDate <= today ? occurrenceDate : today;
  return (
    <div className="stack-sm">
      <form onSubmit={onSubmit} className="row" style={{ alignItems: "flex-end" }}>
        <input type="hidden" name="mode" value="confirm" />
        <input type="hidden" name="rule_id" value={ruleId} />
        <input type="hidden" name="occurrence_date" value={occurrenceDate} />
        <label className="field" style={{ flex: "1 1 130px" }}>
          <span className="field-label">Date réelle</span>
          <input name="date" type="date" className="input" defaultValue={defaultDate} max={today} />
        </label>
        <label className="field" style={{ flex: "1 1 110px" }}>
          <span className="field-label">Montant réel (€)</span>
          <input name="amount" className="input num" inputMode="decimal" defaultValue={amount} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Confirmer"}
        </button>
      </form>
      <div className="row">
        <ActionButton
          action={resolveOccurrenceAction}
          fields={{ mode: "skip", rule_id: ruleId, occurrence_date: occurrenceDate }}
          confirm="Ignorer cette échéance ? Elle ne sera plus attendue (l'opération annulée reste visible dans l'historique)."
          className="btn btn-ghost btn-sm"
        >
          Ignorer cette échéance
        </ActionButton>
        {state.status !== "idle" && state.message && (
          <span role="status" className={`small ${state.status === "error" ? "neg" : "pos"}`}>
            {state.message}
          </span>
        )}
      </div>
    </div>
  );
}
