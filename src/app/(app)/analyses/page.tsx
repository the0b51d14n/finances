import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { formatMonth, formatMonthShort } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { compareAmounts, journalMonths, monthEndBalances, summarizeMonth } from "@/lib/domain/monthly";
import { formatCents, formatPct } from "@/lib/money";

export const metadata: Metadata = { title: "Analyses mensuelles" };

export default function AnalysesPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Journal />
    </Suspense>
  );
}

async function Journal() {
  const data = await loadFinanceData();
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const months = journalMonths(data.accounts, data.transactions, data.today); // du plus récent au plus ancien
  const summaries = months.map((m) => summarizeMonth(data.transactions, m, accountsById, { today: data.today }));
  const chartMonths = months.slice(0, Math.max(data.settings.comparisonMonths, 2)).reverse();
  const chartSummaries = chartMonths.map((m) => summaries[months.indexOf(m)]);
  const balances = monthEndBalances(data.accounts, data.transactions, chartMonths, data.today);

  return (
    <div className="stack">
      <PageHeader title="Analyses mensuelles" subtitle="Journal des mois, calculé à partir des seules opérations confirmées." />

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>Revenus et dépenses</h2>
            <span className="faint small">{chartMonths.length} derniers mois</span>
          </div>
          <LineChart
            ariaLabel="Revenus et dépenses par mois"
            labels={chartMonths.map(formatMonthShort)}
            series={[
              { id: "income", label: "Revenus", slot: 1, values: chartSummaries.map((s) => s.incomeCents) },
              { id: "expense", label: "Dépenses", slot: 2, values: chartSummaries.map((s) => s.expenseCents) },
            ]}
          />
        </section>
        <section className="card">
          <div className="card-header">
            <h2>Soldes de fin de mois</h2>
            <span className="faint small">Constaté</span>
          </div>
          <LineChart
            ariaLabel="Évolution du total des soldes et de l'épargne"
            labels={chartMonths.map(formatMonthShort)}
            series={[
              { id: "total", label: "Total des soldes", slot: 1, values: balances.map((b) => b.totals.totalCents) },
              { id: "savings", label: "Épargne", slot: 2, values: balances.map((b) => b.totals.savingsCents) },
            ]}
          />
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Journal</h2>
        </div>
        <ul className="list">
          {months.map((month, i) => {
            const s = summaries[i];
            const prev = summaries[i + 1];
            const expenseCmp = prev ? compareAmounts(s.expenseCents, prev.expenseCents) : null;
            return (
              <li key={month}>
                <Link href={`/analyses/${month}`} className="list-link" prefetch>
                  <span className="list-main">
                    <span className="row" style={{ gap: 6 }}>
                      <strong style={{ fontWeight: 600 }}>{formatMonth(month)}</strong>
                      {s.provisional && <Badge tone="estimate">Provisoire</Badge>}
                    </span>
                    <span className="faint tiny num">
                      Revenus {formatCents(s.incomeCents)} · Dépenses {formatCents(s.expenseCents)}
                      {expenseCmp?.pct !== null && expenseCmp?.pct !== undefined && ` (${formatPct(expenseCmp.pct, { signed: true })})`} · Épargne{" "}
                      {s.savingsRatePct === null ? "—" : formatPct(s.savingsRatePct)}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {s.transactionCount === 0 ? <span className="faint small">Aucune opération</span> : <Amount cents={s.netCents} signed colored />}
                    <Icon name="chevron" size={16} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
