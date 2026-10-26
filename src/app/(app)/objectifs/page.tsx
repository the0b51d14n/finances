import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/ui/Icon";
import { Badge, EmptyState, Notice, PageHeader, PageSkeleton, ProgressBar, StatTile } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { balancesAt, totalsByClass } from "@/lib/domain/accounts";
import { PRIORITY_LABELS, goalAccumulated, goalProgress, overAllocatedAccounts } from "@/lib/domain/goals";
import { formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "Épargne et objectifs" };

export default function GoalsPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Goals />
    </Suspense>
  );
}

async function Goals() {
  const data = await loadFinanceData();
  const balances = balancesAt(data.accounts, data.transactions, data.today);
  const totals = totalsByClass(data.accounts, balances);
  const active = data.goals.filter((g) => !g.archivedAt);
  const archived = data.goals.filter((g) => g.archivedAt);
  const allocated = active.reduce((s, g) => s + goalAccumulated(g, data.allocations, balances), 0);
  const overAllocated = overAllocatedAccounts(active, data.allocations, balances);
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const unallocatedSavings = totals.savingsCents + totals.availableCents - allocated;

  return (
    <div className="stack">
      <PageHeader
        title="Épargne et objectifs"
        subtitle="Un objectif réserve une part de l'argent déjà présent sur vos comptes : il ne s'ajoute jamais aux soldes."
        actions={
          <Link href="/objectifs/nouveau" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nouvel objectif
          </Link>
        }
      />

      <section className="grid-stats">
        <StatTile label="Épargne totale" cents={totals.savingsCents} nature="actual" />
        <StatTile label="Affecté aux objectifs" cents={allocated} nature="actual" hint="Inclus dans vos soldes, pas en plus" />
        <StatTile label="Disponible + épargne non affectés" cents={unallocatedSavings} nature="actual" tone="auto" />
      </section>

      {overAllocated.map((o) => (
        <Notice key={o.accountId} tone="warning" title="Affectations supérieures au solde">
          Les objectifs liés à {accountsById.get(o.accountId)?.name} totalisent {formatCents(o.allocatedCents)} alors que le compte n&apos;a que{" "}
          {formatCents(o.balanceCents)}. Réduisez les affectations pour éviter de compter deux fois le même argent.
        </Notice>
      ))}

      {active.length === 0 ? (
        <div className="card">
          <EmptyState icon="target" title="Aucun objectif">
            Créez par exemple une épargne de sécurité, l&apos;achat d&apos;un ordinateur ou vos vacances.
          </EmptyState>
        </div>
      ) : (
        <div className="grid-2">
          {active.map((g) => {
            const p = goalProgress({
              targetCents: g.targetCents,
              accumulatedCents: goalAccumulated(g, data.allocations, balances),
              targetDate: g.targetDate,
              monthlyContributionCents: g.monthlyContributionCents,
              today: data.today,
            });
            return (
              <Link key={g.id} href={`/objectifs/${g.id}`} className="card stack-sm" style={{ display: "flex" }}>
                <div className="row-between">
                  <h2>{g.name}</h2>
                  {p.achieved || g.achievedAt ? (
                    <Badge tone="positive">Atteint</Badge>
                  ) : p.onTrack === false ? (
                    <Badge tone="estimate">En retard</Badge>
                  ) : (
                    <Badge>Priorité {PRIORITY_LABELS[g.priority].toLowerCase()}</Badge>
                  )}
                </div>
                <div className="row-between num">
                  <span style={{ fontSize: "1.2rem", fontWeight: 600 }}>{formatCents(p.accumulatedCents)}</span>
                  <span className="muted small">sur {formatCents(g.targetCents)}</span>
                </div>
                <ProgressBar pct={p.pct} level={p.achieved ? "ok" : "accent"} label={`Progression ${g.name}`} />
                <p className="faint small">
                  {p.pct.toLocaleString("fr-FR")} % · reste {formatCents(p.remainingCents)}
                  {p.neededPerMonthCents !== null && ` · ${formatCents(p.neededPerMonthCents)}/mois nécessaires`}
                  {p.estimatedDate && !p.achieved && ` · atteinte estimée ${formatDate(p.estimatedDate, "short")}`}
                  {p.targetPassed && " · date cible dépassée"}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <details className="disclosure card">
          <summary>Objectifs archivés ({archived.length})</summary>
          <ul className="list">
            {archived.map((g) => (
              <li key={g.id}>
                <Link href={`/objectifs/${g.id}`} className="list-link">
                  <span>{g.name}</span>
                  <span className="num faint">{formatCents(g.targetCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
