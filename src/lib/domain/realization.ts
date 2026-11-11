/**
 * Réalisation automatique : il n'existe aucune étape de confirmation.
 *
 *  - Une opération prévue dont la date est atteinte (aujourd'hui ou avant)
 *    devient effectuée, à sa date.
 *  - Une échéance récurrente dont la date est atteinte, suivie et pas encore
 *    enregistrée, est enregistrée comme opération effectuée, au montant de la
 *    règle et à la date de l'échéance. Le montant peut ensuite être corrigé en
 *    modifiant l'opération.
 *
 * Fonction pure : elle liste ce qu'il faut enregistrer ; l'écriture est faite
 * par la couche de données (src/lib/data/load.ts) via les fonctions SQL.
 */
import type { IsoDate } from "@/lib/dates";
import { buildEntries, type EntryInput } from "./ledger";
import { listOccurrences, realizationIndex } from "./recurrence";
import type { Account, RecurringRule, Transaction } from "./types";

export type DueRealization =
  | { type: "confirm"; transactionId: string }
  | { type: "occurrence"; ruleId: string; date: IsoDate; payload: Record<string, unknown> };

export function dueRealizations(input: {
  today: IsoDate;
  accounts: Account[];
  transactions: Transaction[];
  rules: RecurringRule[];
}): DueRealization[] {
  const { today } = input;
  const due: DueRealization[] = [];

  for (const tx of input.transactions) {
    if (tx.status === "planned" && tx.date <= today) due.push({ type: "confirm", transactionId: tx.id });
  }

  const accountsById = new Map(input.accounts.map((a) => [a.id, a]));
  const index = realizationIndex(input.transactions);
  for (const rule of input.rules) {
    if (!rule.isActive) continue;
    // Échéances suivies jusqu'à aujourd'hui inclus, sans opération liée.
    const occurrences = listOccurrences(rule, rule.trackingStart, today, today, index).filter(
      (o) => o.transaction === null && (o.status === "overdue" || o.status === "pending"),
    );
    if (occurrences.length === 0) continue;

    const entryInput: EntryInput =
      rule.kind === "transfer"
        ? { kind: "transfer", amountCents: rule.amountCents, fromAccountId: rule.accountId, toAccountId: rule.toAccountId ?? "" }
        : { kind: rule.kind, amountCents: rule.amountCents, accountId: rule.accountId };
    const built = buildEntries(entryInput, accountsById);
    // Compte supprimé ou incompatible : rien n'est enregistré pour cette règle.
    if (!built.ok) continue;
    const involved = built.entries.map((e) => accountsById.get(e.accountId));
    // Compte archivé : il ne reçoit plus d'opérations (la base le refuserait).
    if (involved.some((a) => !a || a.archivedAt)) continue;

    for (const occ of occurrences) {
      due.push({
        type: "occurrence",
        ruleId: rule.id,
        date: occ.date,
        payload: {
          kind: rule.kind,
          status: "confirmed",
          date: occ.date,
          label: rule.label,
          amount_cents: rule.amountCents,
          expected_amount_cents: rule.amountCents,
          category_id: rule.categoryId,
          recurrence_id: rule.id,
          occurrence_date: occ.date,
          entries: built.entries.map((e) => ({ account_id: e.accountId, amount_cents: e.amountCents })),
        },
      });
    }
  }
  return due;
}
