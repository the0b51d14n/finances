/**
 * Construction des écritures comptables d'une opération.
 *
 * L'utilisateur saisit un montant positif et un type de mouvement ; cette
 * fonction pure traduit la saisie en écritures signées, que la base de
 * données revérifie (contrainte différée check_transaction_integrity).
 */
import type { Cents } from "@/lib/money";
import { isTransferable } from "./accounts";
import type { Account, Entry, Transaction, TransactionKind } from "./types";

export type EntryInput =
  | {
      kind: "expense";
      amountCents: Cents;
      accountId: string;
      /** Part payée en tickets-restaurant (0 si aucune). */
      voucherAccountId?: string | null;
      voucherCents?: Cents;
    }
  | { kind: "income"; amountCents: Cents; accountId: string }
  | { kind: "transfer"; amountCents: Cents; fromAccountId: string; toAccountId: string }
  | { kind: "adjustment"; amountCents: Cents; accountId: string; direction: "increase" | "decrease" };

export type EntryResult = { ok: true; entries: Entry[] } | { ok: false; error: string };

export function buildEntries(input: EntryInput, accountsById: Map<string, Account>): EntryResult {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "Le montant doit être strictement positif." };
  }

  const requireAccount = (id: string | null | undefined): Account | null => (id ? accountsById.get(id) ?? null : null);

  switch (input.kind) {
    case "income": {
      if (!requireAccount(input.accountId)) return { ok: false, error: "Compte invalide." };
      return { ok: true, entries: [{ accountId: input.accountId, amountCents: input.amountCents }] };
    }
    case "expense": {
      const account = requireAccount(input.accountId);
      if (!account) return { ok: false, error: "Compte invalide." };
      const voucherCents = input.voucherCents ?? 0;
      if (!Number.isSafeInteger(voucherCents) || voucherCents < 0) {
        return { ok: false, error: "La part en tickets-restaurant est invalide." };
      }
      if (voucherCents === 0) {
        return { ok: true, entries: [{ accountId: input.accountId, amountCents: -input.amountCents }] };
      }
      const voucher = requireAccount(input.voucherAccountId);
      if (!voucher || voucher.type !== "meal_voucher") {
        return { ok: false, error: "Choisissez un portefeuille de tickets-restaurant." };
      }
      if (voucherCents > input.amountCents) {
        return { ok: false, error: "La part en tickets-restaurant dépasse le montant total." };
      }
      if (voucher.id === account.id) {
        // Dépense entièrement payée depuis le portefeuille de tickets.
        if (voucherCents !== input.amountCents) {
          return { ok: false, error: "Le compte payeur et le portefeuille de tickets doivent être différents." };
        }
        return { ok: true, entries: [{ accountId: voucher.id, amountCents: -input.amountCents }] };
      }
      const entries: Entry[] = [];
      const bankPart = input.amountCents - voucherCents;
      if (bankPart > 0) entries.push({ accountId: account.id, amountCents: -bankPart });
      entries.push({ accountId: voucher.id, amountCents: -voucherCents });
      return { ok: true, entries };
    }
    case "transfer": {
      const from = requireAccount(input.fromAccountId);
      const to = requireAccount(input.toAccountId);
      if (!from || !to) return { ok: false, error: "Comptes source et destinataire requis." };
      if (from.id === to.id) return { ok: false, error: "Les comptes source et destinataire doivent être différents." };
      if (!isTransferable(from.type) || !isTransferable(to.type)) {
        return { ok: false, error: "Les tickets-restaurant et avantages affectés ne peuvent pas être transférés." };
      }
      return {
        ok: true,
        entries: [
          { accountId: from.id, amountCents: -input.amountCents },
          { accountId: to.id, amountCents: input.amountCents },
        ],
      };
    }
    case "adjustment": {
      if (!requireAccount(input.accountId)) return { ok: false, error: "Compte invalide." };
      const sign = input.direction === "increase" ? 1 : -1;
      return { ok: true, entries: [{ accountId: input.accountId, amountCents: sign * input.amountCents }] };
    }
  }
}

/**
 * Ajustement explicite pour aligner un solde calculé sur le solde réellement
 * constaté. Renvoie null si aucun écart.
 */
export function adjustmentFor(currentCents: Cents, observedCents: Cents): { direction: "increase" | "decrease"; amountCents: Cents } | null {
  const delta = observedCents - currentCents;
  if (delta === 0) return null;
  return { direction: delta > 0 ? "increase" : "decrease", amountCents: Math.abs(delta) };
}

/** Répartition d'une dépense entre la banque et les tickets-restaurant. */
export function expenseSplit(tx: Pick<Transaction, "kind" | "entries" | "amountCents">, accountsById: Map<string, Account>) {
  let voucherCents = 0;
  if (tx.kind === "expense") {
    for (const e of tx.entries) {
      if (accountsById.get(e.accountId)?.type === "meal_voucher") voucherCents += -e.amountCents;
    }
  }
  return { totalCents: tx.amountCents, voucherCents, otherCents: tx.amountCents - voucherCents };
}

/** Reconstitue la saisie d'origine à partir des écritures (pour l'édition). */
export function entriesToInput(
  tx: Pick<Transaction, "kind" | "entries" | "amountCents">,
  accountsById: Map<string, Account>,
): EntryInput | null {
  const kind: TransactionKind = tx.kind;
  const entries = tx.entries;
  switch (kind) {
    case "income":
      return entries[0] ? { kind, amountCents: tx.amountCents, accountId: entries[0].accountId } : null;
    case "expense": {
      const voucher = entries.find((e) => accountsById.get(e.accountId)?.type === "meal_voucher");
      const other = entries.find((e) => e !== voucher);
      if (!voucher) return other ? { kind, amountCents: tx.amountCents, accountId: other.accountId } : null;
      return {
        kind,
        amountCents: tx.amountCents,
        accountId: (other ?? voucher).accountId,
        voucherAccountId: voucher.accountId,
        voucherCents: -voucher.amountCents,
      };
    }
    case "transfer": {
      const from = entries.find((e) => e.amountCents < 0);
      const to = entries.find((e) => e.amountCents > 0);
      return from && to ? { kind, amountCents: tx.amountCents, fromAccountId: from.accountId, toAccountId: to.accountId } : null;
    }
    case "adjustment":
      return entries[0]
        ? {
            kind,
            amountCents: tx.amountCents,
            accountId: entries[0].accountId,
            direction: entries[0].amountCents > 0 ? "increase" : "decrease",
          }
        : null;
  }
}
