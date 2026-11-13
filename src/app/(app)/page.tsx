import Link from "next/link";
import { Suspense } from "react";
import { BarList } from "@/components/charts/BarList";
import { ExpenseForm, SalaryForm } from "@/components/forms/DashboardForms";
import { Icon } from "@/components/ui/Icon";
import { Amount, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { formatDate, formatMonth } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { accountClass } from "@/lib/domain/accounts";
import { SALARIES, computeDashboard, defaultExpenseAccount, salaryAccount } from "@/lib/domain/dashboard";
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
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const expenseRows = d.expenses.map((e) => ({ key: e.categoryId || "none", label: categoryName.get(e.categoryId) ?? "Sans domaine", cents: e.cents }));
  const expenseCategories = data.categories.filter((c) => c.kind === "expense" && !c.archivedAt).map((c) => ({ id: c.id, name: c.name }));
  // Comptes qui peuvent payer une dépense (ni dette ni placement).
  const payers = accounts.filter((a) => !["debt", "investment"].includes(accountClass(a.type))).map((a) => ({ id: a.id, name: a.name }));
  const salaryTarget = salaryAccount(accounts);
  const preferred = defaultExpenseAccount(accounts);
  const defaultPayer = payers.find((p) => p.id === preferred?.id) ?? payers[0];

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

      <section className="card stack-sm" aria-labelledby="depenses">
        <div className="card-header">
          <h2 id="depenses">Dépenses par domaine</h2>
          <span className="faint small">
            {formatMonth(data.today.slice(0, 7))} · <Amount cents={d.expenseTotalCents} />
          </span>
        </div>
        {expenseRows.length > 0 && <BarList rows={expenseRows} total={d.expenseTotalCents} ariaLabel="Dépenses du mois par domaine" />}
        <ExpenseForm categories={expenseCategories} accounts={payers} defaultAccountId={defaultPayer?.id ?? ""} />
      </section>
    </div>
  );
}
