import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/ui/Icon";
import { Amount, PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import {
  addDays,
  addMonthsToKey,
  endOfMonth,
  endOfWeek,
  formatDate,
  formatMonth,
  isValidMonthKey,
  monthKeyOf,
  startOfMonth,
  startOfWeek,
  type IsoDate,
} from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { FREQUENCY_LABELS, OCCURRENCE_STATUS_LABELS, listOccurrences, monthlyEquivalentCents, nextOccurrence, realizationIndex, type OccurrenceStatus } from "@/lib/domain/recurrence";
import { formatCents } from "@/lib/money";
import { KIND_LABELS } from "@/lib/view/labels";
import styles from "./calendar.module.css";

export const metadata: Metadata = { title: "Calendrier financier" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type CalendarItem = {
  date: IsoDate;
  label: string;
  kind: "expense" | "income" | "transfer" | "adjustment";
  amountCents: number;
  status: OccurrenceStatus;
  href: string;
};

export default function CalendarPage(props: PageProps<"/calendrier">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Calendar searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Calendar({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const data = await loadFinanceData();
  const today = data.today;
  const month = isValidMonthKey(one(params.mois)) ? one(params.mois) : monthKeyOf(today);
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const index = realizationIndex(data.transactions);

  const items: CalendarItem[] = [];
  for (const rule of data.rules) {
    for (const occ of listOccurrences(rule, start, end, today, index)) {
      // Hors suivi ou ignorée (opération annulée) : rien à afficher.
      if (occ.status === "untracked" || occ.status === "skipped") continue;
      items.push({
        date: occ.transaction && occ.status === "realized" ? occ.transaction.date : occ.date,
        label: rule.label,
        kind: rule.kind,
        amountCents: occ.transaction?.amountCents ?? rule.amountCents,
        status: occ.status,
        href: occ.transaction ? `/operations/${occ.transaction.id}` : `/calendrier/regles/${rule.id}`,
      });
    }
  }
  for (const tx of data.transactions) {
    if (tx.status !== "planned" || tx.recurrenceId || tx.date < start || tx.date > end) continue;
    items.push({ date: tx.date, label: tx.label, kind: tx.kind, amountCents: tx.amountCents, status: tx.date < today ? "overdue" : "planned", href: `/operations/${tx.id}` });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDay = new Map<IsoDate, CalendarItem[]>();
  for (const item of items) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);

  const pendingIncome = items.filter((i) => i.kind === "income" && (i.status === "pending" || i.status === "planned" || i.status === "overdue")).reduce((s, i) => s + i.amountCents, 0);
  const pendingExpense = items.filter((i) => i.kind === "expense" && (i.status === "pending" || i.status === "planned" || i.status === "overdue")).reduce((s, i) => s + i.amountCents, 0);

  const activeRules = data.rules.filter((r) => r.isActive);
  const monthlyFixed = activeRules.filter((r) => r.kind === "expense").reduce((s, r) => s + monthlyEquivalentCents(r.amountCents, r.frequency), 0);
  const monthlyIncome = activeRules.filter((r) => r.kind === "income").reduce((s, r) => s + monthlyEquivalentCents(r.amountCents, r.frequency), 0);

  const weeks: IsoDate[][] = [];
  for (let d = startOfWeek(start); d <= endOfWeek(end); d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }

  const itemClass = (i: CalendarItem) =>
    [styles.item, styles[i.kind === "adjustment" ? "transfer" : i.kind], i.status === "realized" ? styles.done : "", i.status === "skipped" ? styles.skipped : "", i.status === "overdue" ? styles.overdue : ""].join(" ");

  return (
    <div className="stack">
      <PageHeader
        title="Calendrier financier"
        subtitle="Échéances récurrentes et opérations à venir. Chacune compte automatiquement à sa date."
        actions={
          <Link href="/calendrier/regles/nouvelle" className="btn btn-primary">
            <Icon name="plus" size={16} /> Échéance récurrente
          </Link>
        }
      />

      <section className="grid-stats">
        <StatTile label="Revenus restant à venir ce mois" cents={pendingIncome} nature="forecast" />
        <StatTile label="Dépenses restant à venir ce mois" cents={pendingExpense} nature="forecast" />
        <StatTile label="Charges récurrentes (équiv. mensuel)" cents={monthlyFixed} nature="estimate" />
        <StatTile label="Revenus récurrents (équiv. mensuel)" cents={monthlyIncome} nature="estimate" />
      </section>

      <section className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <Link href={`/calendrier?mois=${addMonthsToKey(month, -1)}`} className="btn btn-ghost" aria-label="Mois précédent">
            <Icon name="back" />
          </Link>
          <h2>{formatMonth(month)}</h2>
          <Link href={`/calendrier?mois=${addMonthsToKey(month, 1)}`} className="btn btn-ghost" aria-label="Mois suivant">
            <Icon name="chevron" />
          </Link>
        </div>

        <div className={styles.grid}>
          <div className={styles.weekdays}>
            {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className={styles.week}>
              {week.map((day) => (
                <div key={day} className={`${styles.day} ${monthKeyOf(day) !== month ? styles.outside : ""} ${day === today ? styles.today : ""}`}>
                  <span className={styles.dayNumber}>{Number(day.slice(8))}</span>
                  {(byDay.get(day) ?? []).slice(0, 4).map((item, i) => (
                    <Link key={i} href={item.href} className={itemClass(item)} title={`${item.label} · ${formatCents(item.amountCents)} · ${OCCURRENCE_STATUS_LABELS[item.status]}`}>
                      {formatCents(item.amountCents, { compact: true })} {item.label}
                    </Link>
                  ))}
                  {(byDay.get(day)?.length ?? 0) > 4 && <span className="faint tiny">+{(byDay.get(day)?.length ?? 0) - 4}</span>}
                </div>
              ))}
            </div>
          ))}
          <p className="faint tiny" style={{ marginTop: 8 }}>
            Liseré vert : revenu · rouge : dépense · gris : transfert. Estompé : réalisé. Barré : ignoré.
          </p>
        </div>

        <div className={styles.agenda}>
          {items.length === 0 && <p className="muted small">Aucune échéance ce mois-ci.</p>}
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day} className={styles.agendaDay}>
              <h3>{formatDate(day, "long")}</h3>
              <ul className="list">
                {list.map((item, i) => (
                  <li key={i}>
                    <Link href={item.href} className="list-link">
                      <span className="list-main">
                        <span>{item.label}</span>
                        <span className="faint tiny">
                          {KIND_LABELS[item.kind]} · {OCCURRENCE_STATUS_LABELS[item.status]}
                        </span>
                      </span>
                      <Amount
                        cents={item.kind === "expense" ? -item.amountCents : item.amountCents}
                        signed={item.kind !== "transfer"}
                        colored={item.status !== "skipped"}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Échéances récurrentes</h2>
          <Link href="/calendrier/regles/nouvelle" className="link small">
            Ajouter
          </Link>
        </div>
        {data.rules.length === 0 ? (
          <p className="muted small">Aucune échéance récurrente : ajoutez votre loyer, vos abonnements, votre salaire, vos aides…</p>
        ) : (
          <ul className="list">
            {data.rules.map((rule) => {
              const next = rule.isActive ? nextOccurrence(rule, today) : null;
              return (
                <li key={rule.id}>
                  <Link href={`/calendrier/regles/${rule.id}`} className="list-link">
                    <span className="list-main">
                      <span style={{ fontWeight: 500, opacity: rule.isActive ? 1 : 0.6 }}>{rule.label}</span>
                      <span className="faint tiny">
                        {KIND_LABELS[rule.kind]} · {FREQUENCY_LABELS[rule.frequency]}
                        {next ? ` · prochaine le ${formatDate(next, "short")}` : rule.isActive ? " · terminée" : " · suspendue"}
                      </span>
                    </span>
                    <Amount cents={rule.kind === "expense" ? -rule.amountCents : rule.amountCents} signed={rule.kind !== "transfer"} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
