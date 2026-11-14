import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { deleteTransactionAction } from "@/app/actions/ledger";
import { ExpenseForm } from "@/components/forms/DashboardForms";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Amount, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { addMonthsToKey, formatDate, formatMonth, isValidMonthKey, monthKeyOf } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { unplannedExpenses } from "@/lib/domain/calendar";
import { expenseFormOptions } from "@/lib/domain/dashboard";
import styles from "./operations.module.css";

export const metadata: Metadata = { title: "Opérations" };

export default function OperationsPage(props: PageProps<"/operations">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={2} />}>
      <Operations searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Operations({ searchParams }: { searchParams: PageProps<"/operations">["searchParams"] }) {
  const params = await searchParams;
  const data = await loadFinanceData();
  const requested = typeof params.mois === "string" ? params.mois : "";
  const month = isValidMonthKey(requested) ? requested : monthKeyOf(data.today);

  const expenses = unplannedExpenses(data.transactions, month);
  const total = expenses.reduce((s, t) => s + t.amountCents, 0);
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));

  return (
    <div className="stack">
      <PageHeader title="Opérations" />

      <section className="card stack-sm" aria-labelledby="ajout">
        <div className="card-header">
          <h2 id="ajout">Dépense non prévue</h2>
        </div>
        <ExpenseForm {...expenseFormOptions(data.accounts, data.categories)} today={data.today} unplanned />
      </section>

      <section className="card stack-sm" aria-labelledby="liste">
        <div className="card-header">
          <nav className={styles.monthNav} aria-label="Changer de mois">
            <Link href={`/operations?mois=${addMonthsToKey(month, -1)}`} className="btn btn-ghost btn-sm" aria-label="Mois précédent">
              <Icon name="back" size={16} />
            </Link>
            <h2 id="liste">{formatMonth(month)}</h2>
            <Link href={`/operations?mois=${addMonthsToKey(month, 1)}`} className="btn btn-ghost btn-sm" aria-label="Mois suivant">
              <Icon name="chevron" size={16} />
            </Link>
          </nav>
          <Amount cents={-total} signed className="small" />
        </div>
        {expenses.length === 0 ? (
          <p className="muted small">Aucune dépense non prévue ce mois-ci.</p>
        ) : (
          <ul className="list">
            {expenses.map((t) => (
              <li key={t.id} className="row-between">
                <span className="list-main">
                  <span>{t.label}</span>
                  <span className="faint tiny">
                    {formatDate(t.date, "short")} · {categoryName.get(t.categoryId ?? "") ?? "Sans domaine"}
                    {t.entries[0] && ` · ${accountName.get(t.entries[0].accountId) ?? ""}`}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <Amount cents={-t.amountCents} signed />
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
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
