/** Liste d'opérations, du point de vue global ou d'un compte donné. */
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import type { Account, Category, Transaction } from "@/lib/domain/types";
import { formatCents, type Cents } from "@/lib/money";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/view/labels";

export function TransactionList({
  transactions,
  accountsById,
  categoriesById,
  accountId,
  runningBalances,
  emptyText = "Aucune opération.",
}: {
  transactions: Transaction[];
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  /** Point de vue d'un compte : montant = son écriture. */
  accountId?: string;
  runningBalances?: Map<string, Cents>;
  emptyText?: string;
}) {
  if (transactions.length === 0) return <p className="muted small">{emptyText}</p>;
  return (
    <ul className="list">
      {transactions.map((tx) => {
        const category = tx.categoryId ? categoriesById.get(tx.categoryId) : undefined;
        const voucherCents = tx.entries
          .filter((e) => accountsById.get(e.accountId)?.type === "meal_voucher" && e.amountCents < 0 && tx.kind === "expense")
          .reduce((s, e) => s - e.amountCents, 0);
        const accountsText =
          tx.kind === "transfer"
            ? tx.entries
                .slice()
                .sort((a, b) => a.amountCents - b.amountCents)
                .map((e) => accountsById.get(e.accountId)?.name ?? "?")
                .join(" → ")
            : tx.entries.map((e) => accountsById.get(e.accountId)?.name ?? "?").join(" + ");

        let amount: Cents;
        if (accountId) amount = tx.entries.find((e) => e.accountId === accountId)?.amountCents ?? 0;
        else if (tx.kind === "expense") amount = -tx.amountCents;
        else if (tx.kind === "income") amount = tx.amountCents;
        else if (tx.kind === "adjustment") amount = tx.entries[0]?.amountCents ?? 0;
        else amount = 0;

        const muted = tx.status !== "confirmed";
        const running = runningBalances?.get(tx.id);
        return (
          <li key={tx.id} style={{ opacity: tx.status === "cancelled" ? 0.6 : 1 }}>
            <Link href={`/operations/${tx.id}`} className="list-link">
              <span className="list-main">
                <span style={{ fontWeight: 500, textDecoration: tx.status === "cancelled" ? "line-through" : undefined }}>{tx.label}</span>
                <span className="faint tiny">
                  {formatDate(tx.date, "short")} · {category?.name ?? KIND_LABELS[tx.kind]} · {accountsText}
                </span>
                <span className="row" style={{ gap: 4, marginTop: 2 }}>
                  {tx.status !== "confirmed" && <Badge tone={tx.status === "planned" ? "forecast" : "default"}>{STATUS_LABELS[tx.status]}</Badge>}
                  {tx.recurrenceId && (
                    <span className="faint" title="Échéance récurrente">
                      <Icon name="repeat" size={12} />
                    </span>
                  )}
                  {tx.isExceptional && <Badge tone="estimate">Exceptionnelle</Badge>}
                  {voucherCents > 0 && !accountId && <Badge>dont {formatCents(voucherCents)} en tickets</Badge>}
                </span>
              </span>
              <span className="stack-sm" style={{ alignItems: "flex-end", gap: 0 }}>
                {tx.kind === "transfer" && !accountId ? (
                  <span className="amount muted">
                    <Icon name="swap" size={14} /> {formatCents(tx.amountCents)}
                  </span>
                ) : (
                  <Amount cents={amount} signed colored={!muted} className={muted ? "muted" : ""} />
                )}
                {running !== undefined && <span className="faint tiny num">Solde {formatCents(running)}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
