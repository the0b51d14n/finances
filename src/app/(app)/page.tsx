import Link from "next/link";
import { Suspense } from "react";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { SalaryForm } from "@/components/forms/DashboardForms";
import { Icon } from "@/components/ui/Icon";
import { Amount, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { formatDate, formatMonth, monthKeyOf } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { calendarItems } from "@/lib/domain/calendar";
import { SALARIES, computeDashboard, salaryAccount } from "@/lib/domain/dashboard";
import styles from "./dashboard.module.css";

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const data = await loadFinanceData();
  const accounts = data.accounts.filter((a) => !a.archivedAt);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Tableau de bord" subtitle={formatDate(data.today, "long")} />
        <div className="card">
          <EmptyState
            icon="wallet"
            title="Commencez par créer vos comptes"
            action={
              <Link href="/comptes/nouveau" className="btn btn-primary">
                <Icon name="plus" size={16} /> Créer un compte
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const d = computeDashboard(data);
  // Calendrier en lecture seule : uniquement les dépenses à venir du mois.
  const month = monthKeyOf(data.today);
  const upcoming = calendarItems({ month, today: data.today, transactions: data.transactions, rules: data.rules }).filter(
    (i) => i.kind === "expense" && i.upcoming,
  );
  const upcomingTotal = upcoming.reduce((s, i) => s + i.amountCents, 0);
  const salaryTarget = salaryAccount(accounts);

  return (
    <div className="stack">
      <PageHeader title="Tableau de bord" subtitle={formatDate(data.today, "long")} />

      <section className={styles.balances} aria-label="Soldes">
        <Link href="/comptes" className={`card ${styles.balance} ${styles.balanceMain}`}>
          <span className="muted small">Total possédé</span>
          <Amount cents={d.totalCents} className={styles.balanceValue} />
        </Link>
        <Link href="/comptes" className={`card ${styles.balance}`}>
          <span className="muted small">Épargne</span>
          <Amount cents={d.savingsCents} className={styles.balanceValue} />
        </Link>
      </section>

      <section className="card stack-sm" aria-labelledby="salaires">
        <div className="card-header">
          <h2 id="salaires">Salaires</h2>
          {salaryTarget && <span className="faint small">{salaryTarget.name}</span>}
        </div>
        <ul className={styles.salaries}>
          {SALARIES.map((s) => (
            <li key={s.key} className={styles.salary}>
              <div className={styles.salaryHead}>
                <span className={styles.salaryName}>{s.label}</span>
                {d.salaries[s.key] > 0 && <Amount cents={d.salaries[s.key]} className="pos small" />}
              </div>
              <SalaryForm salary={s.key} label={s.label} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack-sm" aria-labelledby="a-venir">
        <div className="card-header">
          <h2 id="a-venir">Dépenses à venir</h2>
          <span className="faint small">
            {formatMonth(month)} · <Amount cents={upcomingTotal} />
          </span>
        </div>
        <MonthGrid month={month} today={data.today} items={upcoming.map((i) => ({ ...i, upcoming: false }))} />
      </section>
    </div>
  );
}
