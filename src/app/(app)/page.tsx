import Link from "next/link";
import { Suspense } from "react";
import { BarList } from "@/components/charts/BarList";
import { TransactionList } from "@/components/ledger/TransactionList";
import { TransferSuggestions } from "@/components/ledger/TransferSuggestions";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, EmptyState, NatureBadge, Notice, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { addDays, formatDate, formatMonth } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { computeDashboard } from "@/lib/domain/dashboard";
import { formatCents } from "@/lib/money";
import { CERTAINTY_LABELS } from "@/lib/view/labels";
import styles from "./dashboard.module.css";

/** Échéances et revenus affichés dans « À venir ». */
const UPCOMING_DAYS = 30;
const UPCOMING_MAX = 8;
const RECENT_COUNT = 5;

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={4} />}>
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
  const expenseRows = [...d.month.expenseByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, cents]) => ({ key: id || "none", label: categoryName(id), cents }));

  // Échéances et revenus des 30 prochains jours, dans l'ordre chronologique.
  const upcomingEnd = addDays(data.today, UPCOMING_DAYS);
  const upcoming = [...d.upcomingBills, ...d.upcomingIncomes.filter((e) => e.date <= upcomingEnd)]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, UPCOMING_MAX);

  // Dernières opérations saisies (hors prévues), pour vérifier la saisie du jour.
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const recent = data.transactions.filter((t) => t.status !== "planned").slice(0, RECENT_COUNT);

  // Reste à vivre : disponible − échéances à venir − réserve de sécurité.
  const hasScheduled = d.nextIncome !== null || d.reservedCents > 0;
  const remainingHint = !hasScheduled
    ? "Comptes courants et espèces"
    : d.nextIncome
      ? `Reste à vivre jusqu'au ${formatDate(d.reservedUntil, "short")} : ${formatCents(d.remainingUntilIncomeCents)}`
      : `Reste à vivre sur 30 jours : ${formatCents(d.remainingUntilIncomeCents)}`;

  return (
    <div className="stack">
      <PageHeader
        title="Tableau de bord"
        subtitle={formatDate(data.today, "long")}
        actions={
          <>
            <Link href="/operations/nouvelle?type=expense&retour=/" className="btn btn-primary">
              <Icon name="arrowOut" size={16} /> Dépense
            </Link>
            <Link href="/operations/nouvelle?type=income&retour=/" className="btn">
              <Icon name="arrowIn" size={16} /> Revenu
            </Link>
            <Link href="/operations/nouvelle?type=transfer&retour=/" className="btn">
              <Icon name="swap" size={16} /> Virement
            </Link>
          </>
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

      <section className={styles.balances} aria-label="Soldes">
        <Link href="/previsions" className={`card ${styles.balance} ${styles.balanceMain}`}>
          <span className="row-between">
            <span className="muted small">Argent disponible</span>
            <NatureBadge nature="actual" />
          </span>
          <Amount cents={d.totals.availableCents} className={styles.balanceValue} />
          <span className="faint small">{remainingHint}</span>
        </Link>
        <Link href="/objectifs" className={`card ${styles.balance}`}>
          <span className="row-between">
            <span className="muted small">Épargne totale</span>
            <NatureBadge nature="actual" />
          </span>
          <Amount cents={d.totals.savingsCents} className={styles.balanceValue} />
          <span className="faint small">
            {d.allocatedToGoalsCents > 0 ? `dont ${formatCents(d.allocatedToGoalsCents)} affectés aux objectifs` : "Livrets et épargne"}
          </span>
        </Link>
      </section>

      <section className="card stack-sm">
        <div className="card-header">
          <h2>Ce mois-ci</h2>
          <Link href="/analyses" className="link small">
            {formatMonth(data.today.slice(0, 7))}
          </Link>
        </div>
        <div className={styles.month}>
          <div className={styles.figure}>
            <span className="muted small">Revenus</span>
            <Amount cents={d.month.incomeCents} signed className={styles.figureValue} />
          </div>
          <div className={styles.figure}>
            <span className="muted small">Dépenses</span>
            <Amount cents={-d.month.expenseCents} signed className={styles.figureValue} />
            {d.month.voucherExpenseCents > 0 && <span className="faint tiny">dont {formatCents(d.month.voucherExpenseCents)} en tickets</span>}
          </div>
          <div className={styles.figure}>
            <span className="muted small">Solde net du mois</span>
            <Amount cents={d.month.netCents} colored className={styles.figureValue} />
            <span className="faint tiny">Hors virements entre vos comptes</span>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>Dépenses par catégorie</h2>
            <span className="faint small">Ce mois-ci</span>
          </div>
          {expenseRows.length === 0 ? (
            <p className="muted small">Vos catégories apparaîtront ici dès que vous enregistrerez des dépenses.</p>
          ) : (
            <BarList rows={expenseRows} total={d.month.expenseCents} ariaLabel="Répartition des dépenses du mois" />
          )}
        </section>

        {upcoming.length > 0 && (
          <section className="card">
            <div className="card-header">
              <h2>À venir</h2>
              <Link href="/calendrier" className="link small">
                Voir le calendrier
              </Link>
            </div>
            <ul className="list">
              {upcoming.map((e, i) => {
                const isIncome = e.deltaCents > 0;
                return (
                  <li key={i}>
                    <span className="list-main">
                      <span>{e.label}</span>
                      <span className="faint tiny">
                        {e.overdue ? `prévue le ${formatDate(e.originalDate, "short")}` : formatDate(e.date, "short")}
                      </span>
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {e.overdue && <Badge tone="estimate">À confirmer</Badge>}
                      {isIncome && e.certainty !== "certain" && <Badge tone="estimate">{CERTAINTY_LABELS[e.certainty]}</Badge>}
                      <Amount cents={isIncome ? e.grossCents : -e.grossCents} signed colored={isIncome} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {recent.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Dernières opérations</h2>
            <Link href="/operations" className="link small">
              Toutes les opérations
            </Link>
          </div>
          <TransactionList transactions={recent} accountsById={accountsById} categoriesById={categoriesById} />
        </section>
      )}

      {d.transfers.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Virements conseillés</h2>
            <span className="faint small">30 prochains jours</span>
          </div>
          <TransferSuggestions suggestions={d.transfers} accountsById={accountsById} returnTo="/" />
        </section>
      )}
    </div>
  );
}
