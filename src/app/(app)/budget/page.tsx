import type { Metadata } from "next";
import { Suspense } from "react";
import { deleteBudgetAction } from "@/app/actions/planning";
import { BudgetForm } from "@/components/forms/PlanningForms";
import { toCategoryOptions } from "@/components/forms/options";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Badge, EmptyState, PageHeader, PageSkeleton, ProgressBar } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { BUDGET_PERIOD_LABELS, budgetPeriodRange, previousPeriodRange, spentInRange } from "@/lib/domain/budgets";
import { computeBudgetStatuses, forecastEventsFor } from "@/lib/domain/dashboard";
import { centsToInput, formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "Budget" };

export default function BudgetPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Budgets />
    </Suspense>
  );
}

const LEVEL_LABELS = { ok: "Dans le budget", warning: "Bientôt atteint", exceeded: "Dépassé" } as const;

async function Budgets() {
  const data = await loadFinanceData();
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const events = forecastEventsFor(data);
  const statuses = computeBudgetStatuses(data.budgets, data.transactions, events, data.today, data.settings.budgetAlertPct);
  const inactive = data.budgets.filter((b) => !b.isActive);
  const categoryOptions = toCategoryOptions(data.categories);

  return (
    <div className="stack">
      <PageHeader
        title="Budget"
        subtitle="Dépenses confirmées par catégorie, sur des périodes calendaires (semaine du lundi au dimanche, mois)."
      />

      {statuses.length === 0 && (
        <div className="card">
          <EmptyState icon="pie" title="Aucun budget actif">
            Définissez par exemple un budget hebdomadaire pour les courses ou mensuel pour les loisirs.
          </EmptyState>
        </div>
      )}

      <div className="grid-2">
        {statuses.map(({ budget, evaluation: e }) => {
          const range = budgetPeriodRange(budget.period, data.today);
          const prevRange = previousPeriodRange(budget.period, data.today);
          const prevSpent = spentInRange(data.transactions, budget.categoryId, prevRange);
          const name = categoriesById.get(budget.categoryId)?.name ?? "Catégorie";
          return (
            <section key={budget.id} className="card stack-sm">
              <div className="row-between">
                <h2>{name}</h2>
                <Badge tone={e.level === "ok" ? "positive" : e.level === "warning" ? "estimate" : "negative"}>{LEVEL_LABELS[e.level]}</Badge>
              </div>
              <p className="faint tiny">
                {BUDGET_PERIOD_LABELS[budget.period]} · du {formatDate(range.start, "short")} au {formatDate(range.end, "short")} · jour {e.elapsedDays}/{e.totalDays}
              </p>
              <ProgressBar pct={e.consumedPct} level={e.level} label={`Consommation du budget ${name}`} />
              <dl className="form-grid small" style={{ margin: 0, gap: 8 }}>
                <div>
                  <dt className="faint">Prévu</dt>
                  <dd className="num" style={{ margin: 0 }}>{formatCents(e.amountCents)}</dd>
                </div>
                <div>
                  <dt className="faint">Dépensé (constaté)</dt>
                  <dd className="num" style={{ margin: 0 }}>
                    {formatCents(e.spentCents)} · {e.consumedPct.toLocaleString("fr-FR")} %
                  </dd>
                </div>
                <div>
                  <dt className="faint">Restant</dt>
                  <dd className={`num ${e.remainingCents < 0 ? "neg" : ""}`} style={{ margin: 0 }}>
                    {formatCents(e.remainingCents)}
                  </dd>
                </div>
                <div>
                  <dt className="faint">Déjà programmé (non dépensé)</dt>
                  <dd className="num" style={{ margin: 0 }}>{formatCents(e.plannedCents)}</dd>
                </div>
                <div>
                  <dt className="faint">Projection fin de période</dt>
                  <dd className={`num ${e.projectedOverrun ? "neg" : ""}`} style={{ margin: 0 }}>
                    {formatCents(e.projectionCents)}
                  </dd>
                </div>
                <div>
                  <dt className="faint">Période précédente</dt>
                  <dd className="num" style={{ margin: 0 }}>{formatCents(prevSpent)}</dd>
                </div>
              </dl>
              <p className="faint tiny">
                Projection = le plus élevé entre « dépensé + programmé » et le rythme actuel prolongé jusqu&apos;à la fin de la période.
              </p>
              <details className="disclosure">
                <summary>Modifier</summary>
                <div className="stack" style={{ marginTop: 8 }}>
                  <BudgetForm
                    categories={categoryOptions}
                    defaultAlertPct={data.settings.budgetAlertPct}
                    initial={{
                      id: budget.id,
                      categoryId: budget.categoryId,
                      period: budget.period,
                      amount: centsToInput(budget.amountCents),
                      alertPct: budget.alertPct ? String(budget.alertPct) : "",
                      isActive: budget.isActive,
                    }}
                  />
                  <ActionButton action={deleteBudgetAction} fields={{ id: budget.id }} className="btn btn-danger btn-sm" confirm={`Supprimer le budget ${name} ?`}>
                    <Icon name="trash" size={14} /> Supprimer ce budget
                  </ActionButton>
                </div>
              </details>
            </section>
          );
        })}
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Nouveau budget</h2>
        </div>
        <BudgetForm
          categories={categoryOptions}
          defaultAlertPct={data.settings.budgetAlertPct}
          initial={{ categoryId: "", period: "monthly", amount: "", alertPct: "", isActive: true }}
        />
      </section>

      {inactive.length > 0 && (
        <details className="disclosure card">
          <summary>Budgets inactifs ({inactive.length})</summary>
          <ul className="list">
            {inactive.map((b) => (
              <li key={b.id}>
                <span>
                  {categoriesById.get(b.categoryId)?.name} · {BUDGET_PERIOD_LABELS[b.period]}
                </span>
                <span className="row">
                  <span className="num">{formatCents(b.amountCents)}</span>
                  <ActionButton action={deleteBudgetAction} fields={{ id: b.id }} className="btn btn-ghost btn-sm" confirm="Supprimer ce budget ?">
                    <Icon name="trash" size={14} />
                  </ActionButton>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
