import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { deleteAllocationAction, deleteGoalAction, setGoalStateAction } from "@/app/actions/planning";
import { AllocationForm, GoalForm } from "@/components/forms/PlanningForms";
import { toAccountOptions } from "@/components/forms/options";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, Notice, PageHeader, PageSkeleton, ProgressBar, StatTile } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { balancesAt } from "@/lib/domain/accounts";
import { PRIORITY_LABELS, goalAccumulated, goalProgress } from "@/lib/domain/goals";
import { centsToInput, formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "Objectif" };

export default function GoalPage(props: PageProps<"/objectifs/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Goal params={props.params} />
    </Suspense>
  );
}

async function Goal({ params }: { params: PageProps<"/objectifs/[id]">["params"] }) {
  const { id } = await params;
  const data = await loadFinanceData();
  const goal = data.goals.find((g) => g.id === id);
  if (!goal) notFound();

  const balances = balancesAt(data.accounts, data.transactions, data.today);
  const accumulated = goalAccumulated(goal, data.allocations, balances);
  const p = goalProgress({
    targetCents: goal.targetCents,
    accumulatedCents: accumulated,
    targetDate: goal.targetDate,
    monthlyContributionCents: goal.monthlyContributionCents,
    today: data.today,
  });
  const allocations = data.allocations.filter((a) => a.goalId === goal.id).reverse();
  const account = goal.accountId ? data.accounts.find((a) => a.id === goal.accountId) : undefined;
  const plans = data.purchasePlans.filter((pp) => pp.goalId === goal.id);

  return (
    <div className="stack">
      <PageHeader
        title={goal.name}
        subtitle={`Priorité ${PRIORITY_LABELS[goal.priority].toLowerCase()} · ${goal.tracking === "account" ? `suit le solde de ${account?.name ?? "?"}` : "affectations manuelles"}`}
        back={{ href: "/objectifs", label: "Objectifs" }}
      />

      {p.achieved && !goal.achievedAt && (
        <Notice tone="success" title="Montant cible atteint">
          Vous pouvez marquer l&apos;objectif comme atteint : il apparaîtra dans le bilan du mois.
        </Notice>
      )}

      <section className="card stack-sm">
        <div className="row-between num">
          <span style={{ fontSize: "1.6rem", fontWeight: 650 }}>{formatCents(accumulated)}</span>
          <span className="muted">sur {formatCents(goal.targetCents)}</span>
        </div>
        <ProgressBar pct={p.pct} level={p.achieved ? "ok" : "accent"} label="Progression" />
        <p className="faint small">{p.pct.toLocaleString("fr-FR")} % atteint</p>
      </section>

      <section className="grid-stats">
        <StatTile label="Reste à accumuler" cents={p.remainingCents} />
        <StatTile
          label="Nécessaire par mois"
          text={p.neededPerMonthCents !== null ? formatCents(p.neededPerMonthCents) : "—"}
          nature="estimate"
          hint={goal.targetDate ? `pour le ${formatDate(goal.targetDate)} (${p.monthsLeft ?? 0} mois)` : "Aucune date cible"}
        />
        <StatTile
          label="Date estimée d'atteinte"
          text={p.estimatedDate ? formatDate(p.estimatedDate) : "Non calculable"}
          nature="estimate"
          hint={goal.monthlyContributionCents ? `avec ${formatCents(goal.monthlyContributionCents)}/mois` : "Indiquez une contribution mensuelle"}
        />
      </section>
      {p.onTrack === false && (
        <Notice tone="warning">
          {p.targetPassed
            ? "La date cible est dépassée sans que l'objectif soit atteint."
            : "La contribution mensuelle prévue ne suffit pas pour atteindre l'objectif à la date cible."}
        </Notice>
      )}

      {goal.tracking === "manual" && !goal.archivedAt && (
        <section className="card">
          <div className="card-header">
            <h2>Affecter une somme</h2>
          </div>
          <p className="faint small" style={{ marginBottom: 12 }}>
            Affecter ne déplace pas d&apos;argent : vous réservez une part de vos soldes existants. Pour mettre réellement de côté, enregistrez aussi un
            transfert vers votre livret.
          </p>
          <AllocationForm goalId={goal.id} today={data.today} />
        </section>
      )}

      {goal.tracking === "manual" && (
        <section className="card">
          <div className="card-header">
            <h2>Historique des affectations</h2>
          </div>
          {allocations.length === 0 ? (
            <p className="muted small">Aucune affectation.</p>
          ) : (
            <ul className="list">
              {allocations.map((a) => (
                <li key={a.id}>
                  <span className="list-main">
                    <span>{formatDate(a.date)}</span>
                    {a.note && <span className="faint tiny">{a.note}</span>}
                  </span>
                  <span className="row">
                    <Amount cents={a.amountCents} signed colored />
                    <ActionButton action={deleteAllocationAction} fields={{ id: a.id }} className="btn btn-ghost btn-sm" confirm="Supprimer cette affectation ?" showMessage={false}>
                      <Icon name="trash" size={14} />
                    </ActionButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {plans.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Achats envisagés liés</h2>
          </div>
          <ul className="list">
            {plans.map((pp) => (
              <li key={pp.id}>
                <Link href={`/previsions?achat=${pp.id}`} className="list-link">
                  <span>{pp.name}</span>
                  <span className="num">{formatCents(pp.priceCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="disclosure card">
        <summary>Modifier l&apos;objectif</summary>
        <div style={{ marginTop: 12 }}>
          <GoalForm
            accounts={toAccountOptions(data.accounts)}
            initial={{
              id: goal.id,
              name: goal.name,
              target: centsToInput(goal.targetCents),
              targetDate: goal.targetDate ?? "",
              monthlyContribution: goal.monthlyContributionCents ? centsToInput(goal.monthlyContributionCents) : "",
              priority: String(goal.priority),
              tracking: goal.tracking,
              accountId: goal.accountId ?? "",
              notes: goal.notes ?? "",
            }}
          />
        </div>
      </details>

      <section className="row">
        <ActionButton action={setGoalStateAction} fields={{ id: goal.id, field: "achieved_at", value: goal.achievedAt ? "0" : "1" }} className="btn">
          {goal.achievedAt ? "Rouvrir l'objectif" : (
            <>
              <Icon name="check" size={16} /> Marquer comme atteint
            </>
          )}
        </ActionButton>
        <ActionButton action={setGoalStateAction} fields={{ id: goal.id, field: "archived_at", value: goal.archivedAt ? "0" : "1" }} className="btn">
          <Icon name="archive" size={16} /> {goal.archivedAt ? "Réactiver" : "Archiver"}
        </ActionButton>
        <ActionButton action={deleteGoalAction} fields={{ id: goal.id }} className="btn btn-danger" confirm={`Supprimer l'objectif « ${goal.name} » et ses affectations ?`}>
          <Icon name="trash" size={16} /> Supprimer
        </ActionButton>
        {goal.achievedAt && <Badge tone="positive">Atteint le {formatDate(goal.achievedAt.slice(0, 10))}</Badge>}
      </section>
    </div>
  );
}
