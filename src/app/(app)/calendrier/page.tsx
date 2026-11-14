import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { deleteRuleAction, deleteTransactionAction } from "@/app/actions/ledger";
import { MonthGrid, signedAmount } from "@/components/calendar/MonthGrid";
import { ExpenseForm } from "@/components/forms/DashboardForms";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { addMonthsToKey, formatDate, formatMonth, isValidMonthKey, monthKeyOf } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { calendarItems, ruleScheduleText, type CalendarItem } from "@/lib/domain/calendar";
import { expenseFormOptions } from "@/lib/domain/dashboard";
import styles from "./calendar.module.css";

export const metadata: Metadata = { title: "Calendrier" };

export default function CalendarPage(props: PageProps<"/calendrier">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={2} />}>
      <Calendar searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Calendar({ searchParams }: { searchParams: PageProps<"/calendrier">["searchParams"] }) {
  const params = await searchParams;
  const data = await loadFinanceData();
  const requested = typeof params.mois === "string" ? params.mois : "";
  const month = isValidMonthKey(requested) ? requested : monthKeyOf(data.today);

  const items = calendarItems({ month, today: data.today, transactions: data.transactions, rules: data.rules });
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const rulesById = new Map(data.rules.map((r) => [r.id, r]));
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);

  const monthExpenses = items.filter((i) => i.kind === "expense").reduce((s, i) => s + i.amountCents, 0);

  return (
    <div className="stack">
      <PageHeader
        title="Calendrier"
        actions={
          <nav className={styles.monthNav} aria-label="Changer de mois">
            <Link href={`/calendrier?mois=${addMonthsToKey(month, -1)}`} className="btn btn-ghost" aria-label="Mois précédent">
              <Icon name="back" />
            </Link>
            <Link href="/calendrier" className={`btn btn-ghost ${styles.monthLabel}`}>
              {formatMonth(month)}
            </Link>
            <Link href={`/calendrier?mois=${addMonthsToKey(month, 1)}`} className="btn btn-ghost" aria-label="Mois suivant">
              <Icon name="chevron" />
            </Link>
          </nav>
        }
      />

      <section className="card" aria-label={`Calendrier de ${formatMonth(month)}`}>
        <MonthGrid month={month} today={data.today} items={items} dayHref={(date) => `#jour-${date}`} />
      </section>

      <section className="card stack-sm" aria-labelledby="detail">
        <div className="card-header">
          <h2 id="detail">{formatMonth(month)}</h2>
          <span className="faint small">
            Dépenses : <Amount cents={monthExpenses} />
          </span>
        </div>
        {items.length === 0 ? (
          <p className="muted small">Rien ce mois-ci.</p>
        ) : (
          <div className="stack-sm">
            {[...byDate.entries()].map(([date, list]) => (
              <div key={date} id={`jour-${date}`} className={styles.day}>
                <h3 className={styles.dayTitle}>{formatDate(date, "long")}</h3>
                <ul className="list">
                  {list.map((x) => {
                    const rule = x.ruleId ? rulesById.get(x.ruleId) : undefined;
                    const accounts =
                      x.kind === "transfer"
                        ? `${accountName.get(x.accountId) ?? "?"} → ${accountName.get(x.toAccountId ?? "") ?? "?"}`
                        : (accountName.get(x.accountId) ?? "");
                    return (
                      <li key={x.key} className={styles.item}>
                        <span className="list-main">
                          <span>{x.label}</span>
                          <span className="faint tiny">
                            {accounts}
                            {rule && ` · ${ruleScheduleText(rule)}`}
                          </span>
                        </span>
                        <span className={styles.itemSide}>
                          {x.upcoming && <Badge tone="forecast">À venir</Badge>}
                          <Amount cents={signedAmount(x)} signed colored={x.kind === "income"} />
                          {x.transactionId && (
                            <ActionButton
                              action={deleteTransactionAction}
                              fields={{ id: x.transactionId }}
                              className="btn btn-ghost btn-sm"
                              confirm={`Supprimer « ${x.label} » du ${formatDate(x.date)} ?`}
                              showMessage={false}
                            >
                              <Icon name="trash" size={16} label="Supprimer" />
                            </ActionButton>
                          )}
                          {rule && rule.isActive && (
                            <ActionButton
                              action={deleteRuleAction}
                              fields={{ id: rule.id }}
                              className="btn btn-ghost btn-sm"
                              confirm={`Arrêter « ${rule.label} » (${ruleScheduleText(rule).toLowerCase()}) ? Les échéances passées restent enregistrées.`}
                              showMessage={false}
                            >
                              Arrêter
                            </ActionButton>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="ajout">
        <div className="card-header">
          <h2 id="ajout">Ajouter une dépense</h2>
        </div>
        <ExpenseForm {...expenseFormOptions(data)} today={data.today} />
      </section>
    </div>
  );
}
