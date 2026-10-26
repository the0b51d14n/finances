import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { deleteTransactionAction, setTransactionStatusAction } from "@/app/actions/ledger";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { toAccountOptions, toCategoryOptions } from "@/components/forms/options";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, Notice, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/dates";
import { loadFinanceData, loadTransactionAudit } from "@/lib/data/load";
import { entriesToInput, expenseSplit } from "@/lib/domain/ledger";
import { centsToInput, formatCents } from "@/lib/money";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/view/labels";

export const metadata: Metadata = { title: "Opération" };

const AUDIT_LABELS = { update: "Modification", status: "Changement de statut", delete: "Suppression" } as const;

export default function OperationPage(props: PageProps<"/operations/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={2} />}>
      <Operation params={props.params} />
    </Suspense>
  );
}

async function Operation({ params }: { params: PageProps<"/operations/[id]">["params"] }) {
  const { id } = await params;
  const data = await loadFinanceData();
  const tx = data.transactions.find((t) => t.id === id);
  if (!tx) notFound();
  const audit = await loadTransactionAudit(tx.id);

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const category = tx.categoryId ? data.categories.find((c) => c.id === tx.categoryId) : undefined;
  const rule = tx.recurrenceId ? data.rules.find((r) => r.id === tx.recurrenceId) : undefined;
  const split = expenseSplit(tx, accountsById);
  const input = entriesToInput(tx, accountsById);
  const signed = tx.kind === "expense" ? -tx.amountCents : tx.kind === "income" ? tx.amountCents : tx.kind === "adjustment" ? (tx.entries[0]?.amountCents ?? 0) : 0;

  return (
    <div className="stack">
      <PageHeader title={tx.label} subtitle={`${KIND_LABELS[tx.kind]} · ${formatDate(tx.date, "long")}`} back={{ href: "/operations", label: "Opérations" }} />

      {tx.status === "planned" && (
        <Notice tone="info" title="Opération prévue">
          Elle n&apos;est pas comptée dans les soldes ni dans les analyses tant qu&apos;elle n&apos;est pas confirmée.
        </Notice>
      )}
      {tx.status === "cancelled" && <Notice tone="warning" title="Opération annulée">Elle est conservée pour l&apos;historique mais n&apos;a aucun effet.</Notice>}

      <section className="card stack">
        <div className="row-between">
          <div style={{ fontSize: "1.8rem", fontWeight: 650 }}>
            {tx.kind === "transfer" ? <span className="amount">{formatCents(tx.amountCents)}</span> : <Amount cents={signed} signed colored />}
          </div>
          <div className="row">
            <Badge tone={tx.status === "confirmed" ? "positive" : tx.status === "planned" ? "forecast" : "default"}>{STATUS_LABELS[tx.status]}</Badge>
            {tx.isExceptional && <Badge tone="estimate">Exceptionnelle</Badge>}
          </div>
        </div>
        <dl className="form-grid small" style={{ margin: 0 }}>
          <div>
            <dt className="faint">Catégorie</dt>
            <dd style={{ margin: 0 }}>{category?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="faint">Date de l&apos;opération</dt>
            <dd style={{ margin: 0 }}>{formatDate(tx.date)}</dd>
          </div>
          <div>
            <dt className="faint">Créée le</dt>
            <dd style={{ margin: 0 }}>{formatDateTime(tx.createdAt)}</dd>
          </div>
          <div>
            <dt className="faint">Confirmée le</dt>
            <dd style={{ margin: 0 }}>{tx.confirmedAt ? formatDateTime(tx.confirmedAt) : "—"}</dd>
          </div>
          {tx.expectedAmountCents !== null && tx.expectedAmountCents !== tx.amountCents && (
            <div>
              <dt className="faint">Montant estimé</dt>
              <dd style={{ margin: 0 }}>
                {formatCents(tx.expectedAmountCents)} (écart {formatCents(tx.amountCents - tx.expectedAmountCents, { signed: true })})
              </dd>
            </div>
          )}
          {rule && (
            <div>
              <dt className="faint">Échéance récurrente</dt>
              <dd style={{ margin: 0 }}>
                <Link href={`/calendrier/regles/${rule.id}`} className="link">
                  {rule.label}
                </Link>{" "}
                du {formatDate(tx.occurrenceDate!)}
              </dd>
            </div>
          )}
        </dl>
        <div>
          <h3 className="small muted" style={{ marginBottom: 6 }}>
            Écritures comptables
          </h3>
          <ul className="list">
            {tx.entries.map((e) => (
              <li key={e.accountId}>
                <Link href={`/comptes/${e.accountId}`} className="link">
                  {accountsById.get(e.accountId)?.name ?? "Compte"}
                </Link>
                <Amount cents={e.amountCents} signed colored />
              </li>
            ))}
          </ul>
          {split.voucherCents > 0 && (
            <p className="faint small">
              Dépense totale {formatCents(split.totalCents)} : {formatCents(split.otherCents)} par compte, {formatCents(split.voucherCents)} en tickets-restaurant.
            </p>
          )}
        </div>
        {tx.notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{tx.notes}</p>}
        <div className="row">
          {tx.status === "planned" && (
            <ActionButton action={setTransactionStatusAction} fields={{ id: tx.id, status: "confirmed", date: tx.date <= data.today ? tx.date : data.today }} className="btn btn-primary btn-sm">
              <Icon name="check" size={14} /> Confirmer{tx.date > data.today ? " (aujourd'hui)" : ""}
            </ActionButton>
          )}
          {tx.status !== "cancelled" && (
            <ActionButton action={setTransactionStatusAction} fields={{ id: tx.id, status: "cancelled" }} confirm="Annuler cette opération ? Elle restera visible dans l'historique." className="btn btn-sm">
              Annuler l&apos;opération
            </ActionButton>
          )}
          {tx.status !== "planned" && (
            <ActionButton action={setTransactionStatusAction} fields={{ id: tx.id, status: "planned" }} className="btn btn-sm">
              Repasser en prévue
            </ActionButton>
          )}
          <ActionButton
            action={deleteTransactionAction}
            fields={{ id: tx.id, return_to: "/operations" }}
            confirm="Supprimer définitivement cette opération ? Une copie est conservée dans le journal d'audit."
            className="btn btn-danger btn-sm"
          >
            <Icon name="trash" size={14} /> Supprimer
          </ActionButton>
        </div>
      </section>

      {input && (
        <details className="disclosure card">
          <summary>Modifier l&apos;opération</summary>
          <div style={{ marginTop: 12 }}>
            <TransactionForm
              accounts={toAccountOptions(data.accounts)}
              categories={toCategoryOptions(data.categories)}
              today={data.today}
              returnTo={`/operations/${tx.id}`}
              initial={{
                id: tx.id,
                kind: tx.kind,
                status: tx.status,
                date: tx.date,
                label: tx.label,
                amount: centsToInput(tx.amountCents),
                accountId: input.kind === "transfer" ? input.fromAccountId : input.accountId,
                toAccountId: input.kind === "transfer" ? input.toAccountId : "",
                categoryId: tx.categoryId ?? "",
                voucherAccountId: input.kind === "expense" ? (input.voucherAccountId ?? "") : "",
                voucherAmount: input.kind === "expense" && input.voucherCents ? centsToInput(input.voucherCents) : "",
                direction: input.kind === "adjustment" ? input.direction : "increase",
                notes: tx.notes ?? "",
                isExceptional: tx.isExceptional,
                recurrenceId: tx.recurrenceId,
                occurrenceDate: tx.occurrenceDate,
                expectedAmount: tx.expectedAmountCents ? centsToInput(tx.expectedAmountCents) : undefined,
              }}
            />
          </div>
        </details>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Historique des modifications</h2>
        </div>
        {audit.length === 0 ? (
          <p className="muted small">Aucune modification depuis la création.</p>
        ) : (
          <ul className="list">
            {audit.map((a) => (
              <li key={a.id}>
                <span className="list-main">
                  <span>{AUDIT_LABELS[a.action]}</span>
                  <span className="faint tiny">{formatDateTime(a.changedAt)}</span>
                </span>
                <span className="faint small num">
                  avant : {formatCents(Number(a.oldData.amount_cents ?? 0))} · {STATUS_LABELS[(a.oldData.status as keyof typeof STATUS_LABELS) ?? "confirmed"]} ·{" "}
                  {String(a.oldData.date ?? "")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
