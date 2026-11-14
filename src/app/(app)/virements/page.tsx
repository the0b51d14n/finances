import type { Metadata } from "next";
import { Suspense } from "react";
import { deleteRuleAction, deleteTransactionAction } from "@/app/actions/ledger";
import { TransferForm } from "@/components/forms/DashboardForms";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Amount, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { isTransferable } from "@/lib/domain/accounts";
import { ruleScheduleText } from "@/lib/domain/calendar";
import { accountChoices } from "@/lib/domain/dashboard";

export const metadata: Metadata = { title: "Virements" };

export default function TransfersPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={2} />}>
      <Transfers />
    </Suspense>
  );
}

async function Transfers() {
  const data = await loadFinanceData();
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const between = (from: string, to: string | null) => `${accountName.get(from) ?? "?"} → ${accountName.get(to ?? "") ?? "?"}`;
  // Tickets-restaurant et avantages affectés ne se virent pas.
  const transferable = new Set(data.accounts.filter((a) => isTransferable(a.type)).map((a) => a.id));
  const accounts = accountChoices(data)
    .filter((c) => transferable.has(c.id))
    .map((c) => ({ ...c, viaTransfer: false }));
  const recurring = data.rules.filter((r) => r.kind === "transfer" && r.isActive);
  const upcoming = data.transactions.filter((t) => t.kind === "transfer" && t.status === "planned").sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="stack">
      <PageHeader title="Virements" />

      <section className="card stack-sm" aria-labelledby="nouveau">
        <div className="card-header">
          <h2 id="nouveau">Nouveau virement</h2>
        </div>
        <TransferForm accounts={accounts} today={data.today} />
      </section>

      {recurring.length > 0 && (
        <section className="card stack-sm" aria-labelledby="recurrents">
          <div className="card-header">
            <h2 id="recurrents">Virements récurrents</h2>
          </div>
          <ul className="list">
            {recurring.map((r) => (
              <li key={r.id} className="row-between">
                <span className="list-main">
                  <span>{r.label}</span>
                  <span className="faint tiny">
                    {between(r.accountId, r.toAccountId)} · {ruleScheduleText(r)}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <Amount cents={r.amountCents} />
                  <ActionButton
                    action={deleteRuleAction}
                    fields={{ id: r.id }}
                    className="btn btn-ghost btn-sm"
                    confirm={`Arrêter « ${r.label} » ? Les virements déjà passés restent enregistrés.`}
                    showMessage={false}
                  >
                    Arrêter
                  </ActionButton>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="card stack-sm" aria-labelledby="a-venir">
          <div className="card-header">
            <h2 id="a-venir">À venir</h2>
          </div>
          <ul className="list">
            {upcoming.map((t) => {
              const from = t.entries.find((e) => e.amountCents < 0)?.accountId ?? "";
              const to = t.entries.find((e) => e.amountCents > 0)?.accountId ?? null;
              return (
                <li key={t.id} className="row-between">
                  <span className="list-main">
                    <span>{t.label}</span>
                    <span className="faint tiny">
                      {between(from, to)} · {formatDate(t.date)}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <Amount cents={t.amountCents} />
                    <ActionButton
                      action={deleteTransactionAction}
                      fields={{ id: t.id }}
                      className="btn btn-ghost btn-sm"
                      confirm={`Supprimer « ${t.label} » du ${formatDate(t.date)} ?`}
                      showMessage={false}
                    >
                      <Icon name="trash" size={16} label="Supprimer" />
                    </ActionButton>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
