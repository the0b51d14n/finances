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
      /**
       * Autres moyens de paiement de la même dépense (carte cadeau, bon d'achat,
       * espèces, tickets…). Le compte principal paie le reste.
       */
      otherPayments?: { accountId: string; amountCents: Cents }[];
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
      const others = input.otherPayments ?? [];
      if (voucherCents === 0 && others.length === 0) {
        return { ok: true, entries: [{ accountId: input.accountId, amountCents: -input.amountCents }] };
      }
      // Parts payées par d'autres moyens que le compte principal.
      const parts: Entry[] = [];
      if (voucherCents > 0) {
        const voucher = requireAccount(input.voucherAccountId);
        if (!voucher || voucher.type !== "meal_voucher") {
          return { ok: false, error: "Choisissez un portefeuille de tickets-restaurant." };
        }
        if (voucherCents > input.amountCents) {
          return { ok: false, error: "La part en tickets-restaurant dépasse le montant total." };
        }
        if (voucher.id === account.id) {
          // Dépense entièrement payée depuis le portefeuille de tickets.
          if (voucherCents !== input.amountCents || others.length > 0) {
            return { ok: false, error: "Le compte payeur et le portefeuille de tickets doivent être différents." };
          }
          return { ok: true, entries: [{ accountId: voucher.id, amountCents: -input.amountCents }] };
        }
        parts.push({ accountId: voucher.id, amountCents: -voucherCents });
      }
      for (const p of others) {
        if (!requireAccount(p.accountId)) return { ok: false, error: "Moyen de paiement invalide." };
        if (!Number.isSafeInteger(p.amountCents) || p.amountCents <= 0) {
          return { ok: false, error: "Chaque moyen de paiement doit avoir un montant positif." };
        }
        if (p.accountId === account.id || parts.some((e) => e.accountId === p.accountId)) {
          return { ok: false, error: "Chaque moyen de paiement ne peut apparaître qu'une fois (compte principal compris)." };
        }
        parts.push({ accountId: p.accountId, amountCents: -p.amountCents });
      }
      const otherTotal = parts.reduce((s, e) => s - e.amountCents, 0);
      if (otherTotal > input.amountCents) {
        return { ok: false, error: "Les autres moyens de paiement dépassent le montant total." };
      }
      const mainPart = input.amountCents - otherTotal;
      return { ok: true, entries: [...(mainPart > 0 ? [{ accountId: account.id, amountCents: -mainPart }] : []), ...parts] };
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

/** Moyens de paiement d'une dépense autres que le compte principal (tickets compris). */
export function secondaryPayments(input: EntryInput | null): { accountId: string; amountCents: Cents }[] {
  if (!input || input.kind !== "expense") return [];
  const voucher = input.voucherAccountId && input.voucherCents && input.voucherAccountId !== input.accountId
    ? [{ accountId: input.voucherAccountId, amountCents: input.voucherCents }]
    : [];
  return [...voucher, ...(input.otherPayments ?? [])];
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

/**
 * Opérations probablement saisies deux fois : même type, date, montant,
 * libellé (casse ignorée), note et mêmes écritures. Les opérations annulées
 * sont ignorées. Deux achats identiques légitimes se distinguent par une note.
 */
export function possibleDuplicates(transactions: Transaction[]): Transaction[][] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.status === "cancelled") continue;
    const entries = tx.entries.map((e) => `${e.accountId}:${e.amountCents}`).sort().join(",");
    const key = [tx.kind, tx.date, tx.amountCents, tx.label.trim().toLowerCase(), (tx.notes ?? "").trim(), entries].join("|");
    const group = groups.get(key);
    if (group) group.push(tx);
    else groups.set(key, [tx]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export type FrequentOperation = {
  kind: "expense" | "income" | "transfer";
  label: string;
  amountCents: Cents;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  count: number;
};

/**
 * Modèles de saisie rapide : opérations confirmées répétées (même type,
 * libellé, catégorie et compte) depuis `since`, avec le dernier montant saisi.
 * Les échéances récurrentes sont exclues (elles se confirment depuis le calendrier).
 */
export function frequentOperations(transactions: Transaction[], since: string, limit = 6): FrequentOperation[] {
  const groups = new Map<string, FrequentOperation & { lastDate: string }>();
  for (const tx of transactions) {
    if (tx.status !== "confirmed" || tx.date < since || tx.recurrenceId || tx.kind === "adjustment") continue;
    const from = tx.kind === "transfer" ? tx.entries.find((e) => e.amountCents < 0) : tx.entries.find((e) => e.amountCents !== 0);
    const to = tx.kind === "transfer" ? tx.entries.find((e) => e.amountCents > 0) : undefined;
    if (!from) continue;
    const key = [tx.kind, tx.label.trim().toLowerCase(), tx.categoryId ?? "", from.accountId, to?.accountId ?? ""].join("|");
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      if (tx.date > current.lastDate) Object.assign(current, { lastDate: tx.date, amountCents: tx.amountCents, label: tx.label });
    } else {
      groups.set(key, {
        kind: tx.kind,
        label: tx.label,
        amountCents: tx.amountCents,
        accountId: from.accountId,
        toAccountId: to?.accountId ?? null,
        categoryId: tx.categoryId,
        count: 1,
        lastDate: tx.date,
      });
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))
    .slice(0, limit)
    .map((g) => ({
      kind: g.kind,
      label: g.label,
      amountCents: g.amountCents,
      accountId: g.accountId,
      toAccountId: g.toAccountId,
      categoryId: g.categoryId,
      count: g.count,
    }));
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
      const rest = entries.filter((e) => e !== voucher);
      // Compte principal : de préférence un compte bancaire ou des espèces ; les
      // autres moyens (carte cadeau, bon d'achat…) sont des paiements annexes.
      const main = rest.find((e) => { const a = accountsById.get(e.accountId); return !!a && isTransferable(a.type); }) ?? rest[0];
      const others = rest.filter((e) => e !== main).map((e) => ({ accountId: e.accountId, amountCents: -e.amountCents }));
      const extra = others.length > 0 ? { otherPayments: others } : {};
      if (!voucher) return main ? { kind, amountCents: tx.amountCents, accountId: main.accountId, ...extra } : null;
      return {
        kind,
        amountCents: tx.amountCents,
        accountId: (main ?? voucher).accountId,
        voucherAccountId: voucher.accountId,
        voucherCents: -voucher.amountCents,
        ...extra,
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
