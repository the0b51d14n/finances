import Link from "next/link";
import { Suspense } from "react";
import { BarList } from "@/components/charts/BarList";
import { LineChart } from "@/components/charts/LineChart";
import { TransferSuggestions } from "@/components/ledger/TransferSuggestions";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, EmptyState, Notice, PageHeader, PageSkeleton, ProgressBar, StatTile } from "@/components/ui/primitives";
import { formatDate, formatMonthShort } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { accountClass } from "@/lib/domain/accounts";
import { BUDGET_PERIOD_LABELS } from "@/lib/domain/budgets";
import { computeDashboard } from "@/lib/domain/dashboard";
import { formatCents } from "@/lib/money";
import { CERTAINTY_LABELS } from "@/lib/view/labels";

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={6} />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const data = await loadFinanceData();
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const categoryName = (id: string) => categoriesById.get(id)?.name ?? "Sans catégorie";

  if (!data.accounts.some((a) => !a.archivedAt)) {
    return (
      <>
        <PageHeader title="Bienvenue" subtitle={formatDate(data.today, "long")} />
        <div className="card">
          <EmptyState
            icon="wallet"
            title="Commencez par créer vos comptes"
            action={
              <Link href="/comptes/nouveau" className="btn btn-primary">
                <Icon name="plus" size={16} /> Créer mon premier compte
              </Link>
            }
          >
            Indiquez pour chaque compte son solde à une date de référence. Programmez ensuite vos revenus et charges récurrents dans le
            calendrier, puis saisissez vos opérations au fil de l&apos;eau. Aucune donnée d&apos;exemple n&apos;est créée.
          </EmptyState>
        </div>
      </>
    );
  }

  const d = computeDashboard({ ...data, categoryName });
  const earmarked = data.accounts.filter((a) => !a.archivedAt && accountClass(a.type) === "voucher");
  const onlyMealVouchers = earmarked.every((a) => a.type === "meal_voucher");
  const totalParts = [
    d.totals.investmentCents ? `${formatCents(d.totals.investmentCents)} de placements` : null,
    d.totals.reserveCents ? `${formatCents(d.totals.reserveCents)} de réserves` : null,
  ].filter(Boolean);
  const expenseRows = [...d.month.expenseByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, cents]) => ({ key: id || "none", label: categoryName(id), cents }));

  return (
    <div className="stack">
      <PageHeader
        title="Tableau de bord"
        subtitle={formatDate(data.today, "long")}
        actions={
          <Link href="/operations/nouvelle?retour=/" className="btn btn-primary">
            <Icon name="plus" size={16} /> Opération
          </Link>
        }
      />

      {d.alerts.length > 0 && (
        <section className="stack-sm" aria-label="Alertes">
          {d.alerts.map((alert, i) => (
            <Link key={i} href={alert.href ?? "/"}>
              <Notice tone={alert.level === "danger" ? "danger" : alert.level === "warning" ? "warning" : "info"} title={alert.title}>
                {alert.detail}
              </Notice>
            </Link>
          ))}
        </section>
      )}

      <section className="grid-stats" aria-label="Soldes">
        <StatTile label="Argent disponible" cents={d.totals.availableCents} nature="actual" emphasis href="/comptes" hint="Comptes courants et espèces" />
        <StatTile
          label="Épargne totale"
          cents={d.totals.savingsCents}
          nature="actual"
          href="/objectifs"
          hint={d.allocatedToGoalsCents > 0 ? `dont ${formatCents(d.allocatedToGoalsCents)} affectés aux objectifs` : "Livrets et épargne spécifique"}
        />
        <StatTile
          label="Total des soldes"
          cents={d.totals.totalCents}
          nature="actual"
          hint={totalParts.length ? `dont ${totalParts.join(" et ")} · hors dettes` : "Hors ressources affectées et dettes"}
        />
        {d.totals.debtCents !== 0 && (
          <StatTile
            label="Dettes"
            cents={d.totals.debtCents}
            nature="actual"
            href="/comptes"
            hint={`Patrimoine net : ${formatCents(d.totals.netWorthCents)}`}
          />
        )}
        {earmarked.length > 0 && (
          <StatTile
            label={onlyMealVouchers ? "Tickets-restaurant" : "Ressources affectées"}
            cents={d.totals.voucherCents}
            nature="actual"
            href={onlyMealVouchers ? "/ressources" : "/comptes"}
            hint="Ressource affectée, hors total"
          />
        )}
        <StatTile
          label="Réservé aux échéances"
          cents={d.reservedCents}
          nature="forecast"
          href="/calendrier"
          hint={d.nextIncome ? `jusqu'au prochain revenu (${formatDate(d.reservedUntil, "short")})` : `sur les 30 prochains jours`}
        />
        <StatTile
          label={d.nextIncome ? "Reste jusqu'au prochain revenu" : "Reste sur 30 jours"}
          cents={d.remainingUntilIncomeCents}
          nature="forecast"
          tone="auto"
          href="/previsions"
          hint={
            d.perDayCents !== null && d.daysUntilIncome
              ? `soit ${formatCents(d.perDayCents)} par jour pendant ${d.daysUntilIncome} j · réserve de ${formatCents(data.settings.safetyReserveCents)} déduite`
              : "Aucun revenu certain programmé : ajoutez-le dans le calendrier."
          }
        />
      </section>

      <section className="grid-stats" aria-label="Mois en cours">
        <StatTile label="Revenus du mois" cents={d.month.incomeCents} nature="actual" href="/analyses" />
        <StatTile
          label="Dépenses du mois"
          cents={d.month.expenseCents}
          nature="actual"
          href="/analyses"
          hint={d.month.voucherExpenseCents ? `dont ${formatCents(d.month.voucherExpenseCents)} payés en tickets` : undefined}
        />
        <StatTile label="Solde net du mois" cents={d.month.netCents} nature="actual" tone="auto" hint="Revenus − dépenses, hors transferts internes" />
      </section>

      {d.transfers.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Virements conseillés</h2>
            <span className="faint small">30 prochains jours</span>
          </div>
          <TransferSuggestions suggestions={d.transfers} accountsById={new Map(data.accounts.map((a) => [a.id, a]))} returnTo="/" />
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>Prochaines échéances</h2>
            <Link href="/calendrier" className="link small">
              Calendrier
            </Link>
          </div>
          {d.upcomingBills.length === 0 ? (
            <p className="muted small">Aucune dépense programmée dans les 30 prochains jours.</p>
          ) : (
            <ul className="list">
              {d.upcomingBills.map((e, i) => (
                <li key={i}>
                  <span className="list-main">
                    <span>{e.label}</span>
                    <span className="faint tiny">
                      {e.overdue ? `prévue le ${formatDate(e.originalDate, "short")}` : formatDate(e.date, "short")}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {e.overdue && <Badge tone="estimate">À confirmer</Badge>}
                    <Amount cents={-e.grossCents} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Prochains revenus</h2>
            <Link href="/ressources" className="link small">
              Ressources
            </Link>
          </div>
          {d.upcomingIncomes.length === 0 ? (
            <p className="muted small">Aucun revenu programmé dans les 60 prochains jours.</p>
          ) : (
            <ul className="list">
              {d.upcomingIncomes.map((e, i) => (
                <li key={i}>
                  <span className="list-main">
                    <span>{e.label}</span>
                    <span className="faint tiny">{formatDate(e.date, "short")}</span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <Badge tone={e.certainty === "certain" ? "default" : "estimate"}>{CERTAINTY_LABELS[e.certainty]}</Badge>
                    <Amount cents={e.grossCents} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>Dépenses du mois par catégorie</h2>
            <span className="faint small">Constaté</span>
          </div>
          {expenseRows.length === 0 ? (
            <p className="muted small">Aucune dépense confirmée ce mois-ci.</p>
          ) : (
            <BarList rows={expenseRows} total={d.month.expenseCents} ariaLabel="Répartition des dépenses du mois" />
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Évolution sur 6 mois</h2>
            <span className="faint small">Soldes de fin de mois</span>
          </div>
          <LineChart
            ariaLabel="Évolution de l'argent disponible et de l'épargne"
            labels={d.history.map((h) => formatMonthShort(h.month))}
            series={[
              { id: "available", label: "Disponible", slot: 1, values: d.history.map((h) => h.totals.availableCents) },
              { id: "savings", label: "Épargne", slot: 2, values: d.history.map((h) => h.totals.savingsCents) },
            ]}
            height={200}
          />
        </section>
      </div>

      {d.budgets.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Budgets en cours</h2>
            <Link href="/budget" className="link small">
              Gérer
            </Link>
          </div>
          <ul className="list">
            {d.budgets.map(({ budget, evaluation }) => (
              <li key={budget.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div className="row-between">
                  <span>
                    {categoryName(budget.categoryId)} <span className="faint tiny">· {BUDGET_PERIOD_LABELS[budget.period]}</span>
                  </span>
                  <span className="num small">
                    {formatCents(evaluation.spentCents)} / {formatCents(evaluation.amountCents)}
                  </span>
                </div>
                <ProgressBar pct={evaluation.consumedPct} level={evaluation.level} label={`Budget ${categoryName(budget.categoryId)}`} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
