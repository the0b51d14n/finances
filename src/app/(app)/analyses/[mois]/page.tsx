import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BarList } from "@/components/charts/BarList";
import { TransactionList } from "@/components/ledger/TransactionList";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, Notice, PageHeader, PageSkeleton, Variation } from "@/components/ui/primitives";
import { addDays, addMonthsToKey, endOfMonth, formatDate, formatMonth, isValidMonthKey, monthKeyOf, monthRange, startOfMonth, startOfWeek } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { BUDGET_PERIOD_LABELS, budgetPeriodRange, spentInRange } from "@/lib/domain/budgets";
import { buildMonthInsights, type BudgetOverrun } from "@/lib/domain/insights";
import {
  averageSummaries,
  compareAmounts,
  compareCategories,
  monthEndBalances,
  recurringAnomalies,
  samePeriodDay,
  savingsFlows,
  summarizeMonth,
  type Comparison,
} from "@/lib/domain/monthly";
import { formatCents, formatPct } from "@/lib/money";

export const metadata: Metadata = { title: "Analyse du mois" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function MonthPage(props: PageProps<"/analyses/[mois]">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={4} />}>
      <Month params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

const TONE_TO_NOTICE = { positive: "success", negative: "danger", warning: "warning", neutral: "info" } as const;

async function Month({ params, searchParams }: { params: PageProps<"/analyses/[mois]">["params"]; searchParams: Promise<Search> }) {
  const { mois: month } = await params;
  if (!isValidMonthKey(month)) notFound();
  const sp = await searchParams;
  const data = await loadFinanceData();
  const { today } = data;
  if (month > monthKeyOf(today)) notFound();

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const categoryName = (id: string) => categoriesById.get(id)?.name ?? "Sans catégorie";
  const prevMonth = addMonthsToKey(month, -1);
  const isCurrent = month === monthKeyOf(today);

  const current = summarizeMonth(data.transactions, month, accountsById, { today });
  const requested = one(sp.comparer);
  const mode = requested === "periode" && isCurrent ? "periode" : requested === "moyenne" ? "moyenne" : "precedent";
  const n = data.settings.comparisonMonths;
  const history = monthRange(addMonthsToKey(month, -n), prevMonth).map((m) => summarizeMonth(data.transactions, m, accountsById, { today }));

  let reference = summarizeMonth(data.transactions, prevMonth, accountsById, { today });
  let referenceLabel = formatMonth(prevMonth);
  if (mode === "periode") {
    const day = samePeriodDay(today, month)!;
    reference = summarizeMonth(data.transactions, prevMonth, accountsById, { today, upToDay: day });
    // Comparaison équitable : le mois en cours jusqu'au même jour.
    referenceLabel = `${formatMonth(prevMonth)}, du 1er au ${day}`;
  } else if (mode === "moyenne") {
    const avg = averageSummaries(history, prevMonth);
    if (avg) {
      reference = avg;
      referenceLabel = `moyenne des mois renseignés sur ${n} mois`;
    }
  }
  const hasReference = reference.transactionCount > 0;

  const flows = savingsFlows(data.accounts, data.transactions, month, categoriesById, today);
  const prevFlows = savingsFlows(data.accounts, data.transactions, prevMonth, categoriesById, today);
  const [prevBalances, monthBalances] = monthEndBalances(data.accounts, data.transactions, [prevMonth, month], today);
  const anomalies = recurringAnomalies(data.rules, data.transactions, month, today);
  const expenseComparison = compareCategories(current.expenseByCategory, reference.expenseByCategory);
  const incomeComparison = compareCategories(current.incomeByCategory, reference.incomeByCategory);

  // Dépassements de budget sur le mois.
  const overruns: BudgetOverrun[] = [];
  for (const b of data.budgets.filter((x) => x.isActive)) {
    const name = categoryName(b.categoryId);
    if (b.period === "monthly") {
      const spent = spentInRange(data.transactions, b.categoryId, { start: startOfMonth(month), end: endOfMonth(month) });
      if (spent > b.amountCents) overruns.push({ categoryName: name, periodLabel: BUDGET_PERIOD_LABELS.monthly, spentCents: spent, amountCents: b.amountCents });
    } else {
      for (let w = startOfWeek(startOfMonth(month)); w <= endOfMonth(month); w = addDays(w, 7)) {
        if (monthKeyOf(w) !== month) continue;
        const spent = spentInRange(data.transactions, b.categoryId, budgetPeriodRange("weekly", w));
        if (spent > b.amountCents) {
          overruns.push({ categoryName: `${name} (semaine du ${formatDate(w, "short")})`, periodLabel: BUDGET_PERIOD_LABELS.weekly, spentCents: spent, amountCents: b.amountCents });
        }
      }
    }
  }

  const monthTransactions = data.transactions.filter((t) => monthKeyOf(t.date) === month);
  const insights = buildMonthInsights({
    current,
    previous: hasReference ? reference : null,
    history: history.slice(-3),
    categoryName,
    categoryComparison: expenseComparison,
    budgetOverruns: overruns,
    goalsAchieved: data.goals.filter((g) => g.achievedAt && monthKeyOf(g.achievedAt.slice(0, 10)) === month).map((g) => g.name),
    savings: flows,
    anomalies,
    monthTransactions,
    historyTransactions: data.transactions.filter((t) => t.date < startOfMonth(month) && t.date >= startOfMonth(addMonthsToKey(month, -3))),
  });

  const rows: { label: string; cmp: Comparison; invert?: boolean; newLabel: string }[] = [
    { label: "Revenus", cmp: compareAmounts(current.incomeCents, reference.incomeCents), newLabel: "Nouveau revenu" },
    { label: "Dépenses", cmp: compareAmounts(current.expenseCents, reference.expenseCents), invert: true, newLabel: "Nouvelle dépense" },
    { label: "Solde net", cmp: compareAmounts(current.netCents, reference.netCents), newLabel: "Non calculable" },
    { label: "Variation de l'épargne", cmp: compareAmounts(flows.variationCents, prevFlows.variationCents), newLabel: "Non calculable" },
    { label: "Total des soldes (fin de mois)", cmp: compareAmounts(monthBalances.totals.totalCents, prevBalances.totals.totalCents), newLabel: "Non calculable" },
  ];

  const modeHref = (m: string) => (m === "precedent" ? `/analyses/${month}` : `/analyses/${month}?comparer=${m}`);
  const missingCents = anomalies.filter((a) => a.kind === "missing" && a.rule.kind === "expense").reduce((s, a) => s + a.rule.amountCents, 0);
  const upcomingCents = anomalies.filter((a) => a.kind === "upcoming" && a.rule.kind === "expense").reduce((s, a) => s + a.rule.amountCents, 0);

  return (
    <div className="stack">
      <PageHeader
        title={formatMonth(month)}
        subtitle={current.provisional ? "Mois en cours : chiffres provisoires." : "Mois clos."}
        back={{ href: "/analyses", label: "Analyses mensuelles" }}
        actions={
          <div className="row">
            <Link href={`/analyses/${prevMonth}`} className="btn btn-ghost" aria-label="Mois précédent">
              <Icon name="back" />
            </Link>
            {!isCurrent && (
              <Link href={`/analyses/${addMonthsToKey(month, 1)}`} className="btn btn-ghost" aria-label="Mois suivant">
                <Icon name="chevron" />
              </Link>
            )}
          </div>
        }
      />

      {current.provisional && (missingCents > 0 || upcomingCents > 0) && (
        <Notice tone="warning" title="Attention aux comparaisons">
          {missingCents > 0 && `${formatCents(missingCents)} d'échéances attendues ce mois ne sont pas encore comptabilisées. `}
          {upcomingCents > 0 && `${formatCents(upcomingCents)} de dépenses récurrentes sont encore à venir. `}
          Une baisse des dépenses peut donc venir d&apos;un prélèvement pas encore passé, et non d&apos;une économie réelle.
        </Notice>
      )}

      <section className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2>Indicateurs</h2>
          <div className="segmented" style={{ width: "auto" }}>
            <Link href={modeHref("precedent")} className="btn btn-sm btn-ghost" aria-current={mode === "precedent" ? "true" : undefined} style={mode === "precedent" ? { color: "var(--text)", background: "var(--surface-2)" } : undefined}>
              Mois précédent
            </Link>
            {isCurrent && (
              <Link href={modeHref("periode")} className="btn btn-sm btn-ghost" style={mode === "periode" ? { color: "var(--text)", background: "var(--surface-2)" } : undefined}>
                Même période
              </Link>
            )}
            <Link href={modeHref("moyenne")} className="btn btn-sm btn-ghost" style={mode === "moyenne" ? { color: "var(--text)", background: "var(--surface-2)" } : undefined}>
              Moyenne {n} mois
            </Link>
          </div>
        </div>
        <p className="faint small" style={{ marginBottom: 8 }}>
          Comparé à : {referenceLabel}
          {!hasReference && " — aucune donnée sur cette période de référence."}
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Indicateur</th>
                <th className="r">Ce mois</th>
                <th className="r">Référence</th>
                <th className="r">Écart</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="r num">{formatCents(r.cmp.currentCents)}</td>
                  <td className="r num faint">{formatCents(r.cmp.previousCents)}</td>
                  <td className="r">
                    <Variation diffCents={r.cmp.diffCents} pct={r.cmp.pct} note={r.cmp.note} invert={r.invert} newLabel={r.newLabel} />
                  </td>
                </tr>
              ))}
              <tr>
                <td>Taux d&apos;épargne</td>
                <td className="r num">{formatPct(current.savingsRatePct)}</td>
                <td className="r num faint">{formatPct(reference.savingsRatePct)}</td>
                <td className="r num small">
                  {current.savingsRatePct !== null && reference.savingsRatePct !== null
                    ? `${(Math.round((current.savingsRatePct - reference.savingsRatePct) * 10) / 10).toLocaleString("fr-FR")} pt`
                    : "Non calculable"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="faint tiny" style={{ marginTop: 8 }}>
          Écart = montant du mois − référence ; variation en % = écart / référence. Si la référence est nulle : « Nouveau » ou « Non calculable ».
          Transferts internes et ajustements exclus des revenus et dépenses.
        </p>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Bilan automatique</h2>
        </div>
        <div className="stack-sm">
          {insights.map((i, k) => (
            <Notice key={k} tone={TONE_TO_NOTICE[i.tone]}>
              {i.text}
            </Notice>
          ))}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>Dépenses par catégorie</h2>
            <span className="num small">{formatCents(current.expenseCents)}</span>
          </div>
          {current.expenseCents === 0 ? (
            <p className="muted small">Aucune dépense confirmée.</p>
          ) : (
            <BarList
              ariaLabel="Répartition des dépenses"
              total={current.expenseCents}
              rows={[...current.expenseByCategory.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([id, cents]) => ({ key: id || "none", label: categoryName(id), cents, href: id ? `/operations?categorie=${id}&du=${startOfMonth(month)}&au=${endOfMonth(month)}` : undefined }))}
            />
          )}
          {current.voucherExpenseCents > 0 && (
            <p className="faint small" style={{ marginTop: 12 }}>
              Dont {formatCents(current.voucherExpenseCents)} payés en tickets-restaurant ({formatCents(current.expenseCents - current.voucherExpenseCents)} hors tickets).
            </p>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Épargne du mois</h2>
          </div>
          <dl className="stack-sm small" style={{ margin: 0 }}>
            {[
              ["Épargne en début de mois", flows.startCents],
              ["Épargne en fin de mois", flows.endCents],
              ["Variation réelle", flows.variationCents],
              ["dont versements nets (transferts)", flows.contributionsCents],
              ["dont intérêts", flows.interestCents],
              ["dont autres revenus", flows.otherIncomeCents],
              ["dont dépenses payées par l'épargne", -flows.withdrawalsCents],
              ["dont ajustements", flows.adjustmentsCents],
              ["dont nouveaux comptes (soldes initiaux)", flows.openingsCents],
            ].map(([label, cents]) => (
              <div key={label as string} className="row-between">
                <dt className={String(label).startsWith("dont") ? "faint" : ""}>{label}</dt>
                <dd style={{ margin: 0 }}>
                  <Amount cents={cents as number} signed={String(label).startsWith("dont") || label === "Variation réelle"} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="faint tiny" style={{ marginTop: 12 }}>
            Transferts internes du mois : {formatCents(flows.internalTransfersCents)}. Un transfert ne crée pas de richesse : il déplace l&apos;argent entre vos comptes.
            Dépenses exceptionnelles : {formatCents(current.exceptionalExpenseCents)}.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Comparaison par catégorie</h2>
          <span className="faint small">vs {referenceLabel}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Catégorie</th>
                <th className="r">Ce mois</th>
                <th className="r">Référence</th>
                <th className="r">Écart</th>
              </tr>
            </thead>
            <tbody>
              {expenseComparison.map((row, i) => (
                <tr key={row.categoryId}>
                  <td>
                    {categoryName(row.categoryId)}{" "}
                    {i === 0 && row.comparison.diffCents > 0 && <Badge tone="negative">Plus forte hausse</Badge>}
                    {row.categoryId === expenseComparison.find((c) => c.comparison.diffCents < 0)?.categoryId && <Badge tone="positive">Plus forte baisse</Badge>}
                  </td>
                  <td className="r num">{formatCents(row.comparison.currentCents)}</td>
                  <td className="r num faint">{formatCents(row.comparison.previousCents)}</td>
                  <td className="r">
                    <Variation {...row.comparison} diffCents={row.comparison.diffCents} invert newLabel="Nouvelle dépense" />
                  </td>
                </tr>
              ))}
              {incomeComparison.map((row) => (
                <tr key={`i-${row.categoryId}`}>
                  <td>
                    {categoryName(row.categoryId)} <span className="faint tiny">(revenu)</span>
                  </td>
                  <td className="r num">{formatCents(row.comparison.currentCents)}</td>
                  <td className="r num faint">{formatCents(row.comparison.previousCents)}</td>
                  <td className="r">
                    <Variation {...row.comparison} newLabel="Nouveau revenu" />
                  </td>
                </tr>
              ))}
              {expenseComparison.length + incomeComparison.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Aucune donnée à comparer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Opérations du mois</h2>
          <span className="faint small">{monthTransactions.length}</span>
        </div>
        <TransactionList transactions={monthTransactions} accountsById={accountsById} categoriesById={categoriesById} emptyText="Aucune opération ce mois-ci." />
      </section>
    </div>
  );
}
