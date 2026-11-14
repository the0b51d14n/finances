/**
 * Construction des écritures comptables d'une opération.
 *
 * L'utilisateur saisit un montant positif et un type de mouvement ; cette
 * fonction pure traduit la saisie en écritures signées, que la base de
 * données revérifie (contrainte différée check_transaction_integrity).
 */
import type { Cents } from "@/lib/money";
import { isTransferable } from "./accounts";
import type { Account, AccountType, Entry } from "./types";

/**
 * Comptes qui ne paient pas directement (livrets, épargne, placements) : leur
 * part d'une dépense passe d'abord par un virement vers le compte qui paie.
 */
export function paysViaTransfer(type: AccountType): boolean {
  return type === "savings" || type === "dedicated_savings" || type === "investment";
}

export type PaymentPart = { accountId: string; amountCents: Cents };

export type PaymentPlan =
  | { ok: true; entries: Entry[]; transfers: { fromAccountId: string; toAccountId: string; amountCents: Cents }[] }
  | { ok: false; error: string };

/**
 * Dépense payée par plusieurs comptes. Le compte qui paie règle le reste ;
 * chaque autre moyen de paiement règle sa part :
 *  - compte courant, espèces, carte cadeau, bon d'achat, tickets… : directement ;
 *  - livret ou épargne : par un virement préalable vers le compte qui paie
 *    (le « chemin » de l'argent), qui règle alors cette part.
 */
export function planPayment(
  input: { amountCents: Cents; accountId: string; payments: PaymentPart[] },
  accountsById: Map<string, Account>,
): PaymentPlan {
  const main = accountsById.get(input.accountId);
  if (!main) return { ok: false, error: "Compte invalide." };
  if (paysViaTransfer(main.type)) {
    return { ok: false, error: "Un livret ne paie pas directement : choisissez un compte courant et ajoutez le livret comme autre moyen de paiement." };
  }
  const ids = input.payments.map((p) => p.accountId);
  if (new Set(ids).size !== ids.length || ids.includes(main.id)) {
    return { ok: false, error: "Chaque compte ne peut apparaître qu'une fois (compte qui paie compris)." };
  }
  if (input.payments.reduce((s, p) => s + p.amountCents, 0) > input.amountCents) {
    return { ok: false, error: "Les autres moyens de paiement dépassent le montant de la dépense." };
  }

  const direct: PaymentPart[] = [];
  const transfers: { fromAccountId: string; toAccountId: string; amountCents: Cents }[] = [];
  for (const p of input.payments) {
    const account = accountsById.get(p.accountId);
    if (!account || account.archivedAt) return { ok: false, error: "Moyen de paiement invalide." };
    if (account.type === "debt") return { ok: false, error: `${account.name} est une dette : elle ne peut pas payer une dépense.` };
    if (paysViaTransfer(account.type)) {
      if (!isTransferable(main.type)) {
        return { ok: false, error: `Pour utiliser ${account.name}, choisissez un compte courant comme compte qui paie (il reçoit le virement).` };
      }
      transfers.push({ fromAccountId: account.id, toAccountId: main.id, amountCents: p.amountCents });
    } else {
      direct.push(p);
    }
  }
  const built = buildEntries({ kind: "expense", amountCents: input.amountCents, accountId: main.id, otherPayments: direct }, accountsById);
  if (!built.ok) return built;
  return { ok: true, entries: built.entries, transfers };
}

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
