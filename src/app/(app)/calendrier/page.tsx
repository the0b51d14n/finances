import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { deleteRuleAction, deleteTransactionAction } from "@/app/actions/ledger";
import { ExpenseForm } from "@/components/forms/DashboardForms";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { addMonthsToKey, endOfMonth, formatDate, formatMonth, isValidMonthKey, isoWeekday, monthKeyOf, parts, startOfMonth } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { calendarItems, ruleScheduleText, type CalendarItem } from "@/lib/domain/calendar";
import { expenseFormOptions } from "@/lib/domain/dashboard";
import styles from "./calendar.module.css";

export const metadata: Metadata = { title: "Calendrier" };

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
/** Opérations affichées dans une case avant « +N » (le détail complet est sous la grille). */
const PER_CELL = 3;

export default function CalendarPage(props: PageProps<"/calendrier">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={2} />}>
      <Calendar searchParams={props.searchParams} />
    </Suspense>
  );
}

function signed(item: CalendarItem): number {
  return item.kind === "expense" ? -item.amountCents : item.amountCents;
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

  // Grille du lundi précédant le 1er au dimanche suivant la fin du mois.
  const first = startOfMonth(month);
  const lastDay = parts(endOfMonth(month)).day;
  const cells: (string | null)[] = [
    ...Array.from({ length: isoWeekday(first) - 1 }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

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
        <div className={styles.grid}>
          {WEEKDAYS.map((d) => (
            <div key={d} className={styles.weekday} aria-hidden>
              {d}
            </div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`vide-${i}`} className={styles.empty} aria-hidden />;
            const list = byDate.get(date) ?? [];
            const spent = list.filter((x) => x.kind === "expense").reduce((s, x) => s + x.amountCents, 0);
            const content = (
              <>
                <span className={styles.dayNumber}>{parts(date).day}</span>
                <ul className={styles.chips}>
                  {list.slice(0, PER_CELL).map((x) => (
                    <li key={x.key} className={`${styles.chip} ${styles[x.kind]} ${x.upcoming ? styles.upcoming : ""}`}>
                      <span className={styles.chipLabel}>{x.label}</span>
                      <Amount cents={signed(x)} signed className={styles.chipAmount} />
                    </li>
                  ))}
                  {list.length > PER_CELL && <li className="faint tiny">+{list.length - PER_CELL}</li>}
                </ul>
                {spent > 0 && <Amount cents={-spent} signed className={styles.mobileTotal} />}
                {spent === 0 && list.length > 0 && <span className={`${styles.mobileDot} ${styles[list[0].kind]}`} aria-hidden />}
              </>
            );
            return (
              <div key={date} className={`${styles.cell} ${date === data.today ? styles.today : ""}`}>
                {list.length > 0 ? (
                  <a href={`#jour-${date}`} className={styles.cellLink} aria-label={`${formatDate(date, "long")} : ${list.length} opération(s)`}>
                    {content}
                  </a>
                ) : (
                  content
                )}
              </div>
            );
          })}
        </div>
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
                          <Amount cents={signed(x)} signed colored={x.kind === "income"} />
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
        <ExpenseForm {...expenseFormOptions(data.accounts, data.categories)} today={data.today} />
      </section>
    </div>
  );
}
