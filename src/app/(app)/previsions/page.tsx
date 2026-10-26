import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { deletePurchasePlanAction, setPurchaseStatusAction } from "@/app/actions/planning";
import { LineChart } from "@/components/charts/LineChart";
import { PurchaseForm } from "@/components/forms/PlanningForms";
import { toAccountOptions, toCategoryOptions } from "@/components/forms/options";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, Notice, PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import { addDays, formatDate, isValidIsoDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { accountClass, balancesAt, totalsByClass } from "@/lib/domain/accounts";
import { forecastEventsFor, horizonEnd } from "@/lib/domain/dashboard";
import { includeEvent, minBalance, nextIncome, projectDaily, type ForecastEvent } from "@/lib/domain/forecast";
import { PRIORITY_LABELS, goalAccumulated } from "@/lib/domain/goals";
import { VERDICT_LABELS, simulatePurchase, type SimulationResult } from "@/lib/domain/simulator";
import { centsToInput, formatCents, parseAmountToCents } from "@/lib/money";
import { CERTAINTY_LABELS } from "@/lib/view/labels";

export const metadata: Metadata = { title: "Prévisions et simulateur d'achat" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const HORIZONS = [30, 90, 180, 365] as const;
const SOURCE_LABELS = { recurring: "Récurrent", planned: "Prévu", budget: "Enveloppe" } as const;
const VERDICT_TONES = { compatible: "success", reduced_margin: "warning", postpone: "danger", insufficient_data: "info" } as const;

export default function ForecastPage(props: PageProps<"/previsions">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Forecast searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Forecast({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const data = await loadFinanceData();
  const { today, settings } = data;
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const balances = balancesAt(data.accounts, data.transactions, today);
  const totals = totalsByClass(data.accounts, balances);
  const hasAvailable = data.accounts.some((a) => !a.archivedAt && accountClass(a.type) === "available");
  const events = forecastEventsFor(data);
  const end = horizonEnd(today);

  const horizon = HORIZONS.find((h) => String(h) === one(sp.horizon)) ?? 90;
  const scenarioParam = one(sp.scenario);
  const showEstimated = scenarioParam ? scenarioParam === "estime" : settings.forecastIncludeProbable;
  const chartEnd = addDays(today, horizon);
  const withBudgets = settings.preserveBudgetsInForecast;

  const guaranteed = projectDaily(totals.availableCents, events, today, chartEnd, (e) => includeEvent(e, "guaranteed", withBudgets));
  const estimated = projectDaily(totals.availableCents, events, today, chartEnd, (e) => includeEvent(e, "estimated", withBudgets));
  const hasProbable = events.some((e) => e.deltaCents > 0 && e.certainty === "probable");
  const main = showEstimated ? estimated : guaranteed;
  const low = minBalance(main, today, chartEnd);
  const income = nextIncome(events, showEstimated ? "estimated" : "guaranteed", today);
  const uncertain = events.filter((e) => e.deltaCents > 0 && e.certainty === "uncertain" && e.date <= chartEnd);

  // Liste des mouvements à venir avec solde après chacun (scénario affiché).
  const shown = events.filter((e) => e.date <= addDays(today, 60) && includeEvent(e, showEstimated ? "estimated" : "guaranteed", withBudgets));
  const balanceAfter = new Map<ForecastEvent, number>();
  {
    let running = totals.availableCents;
    for (const e of shown) {
      running += e.deltaCents;
      balanceAfter.set(e, running);
    }
  }

  // --- Simulateur ------------------------------------------------------------
  const activeGoals = data.goals.filter((g) => !g.archivedAt && !g.achievedAt);
  const goalsForSim = activeGoals.map((g) => ({
    id: g.id,
    name: g.name,
    monthlyContributionCents: g.monthlyContributionCents,
    accumulatedCents: goalAccumulated(g, data.allocations, balances),
    targetCents: g.targetCents,
  }));
  const plan = data.purchasePlans.find((p) => p.id === one(sp.achat));
  const priceInput = one(sp.prix) || (plan ? centsToInput(plan.priceCents) : "");
  const dateInput = isValidIsoDate(one(sp.date)) ? one(sp.date) : plan?.desiredDate ?? "";
  const nameInput = one(sp.nom) || plan?.name || "";
  const goalInput = one(sp.objectif) || plan?.goalId || "";
  const priceCents = priceInput ? parseAmountToCents(priceInput) : null;
  const priceError = priceInput && (!priceCents || priceCents <= 0);

  const simulate = (price: number, date: string | null, goalId: string | null): SimulationResult =>
    simulatePurchase({
      today,
      horizonEnd: end,
      priceCents: price,
      desiredDate: date,
      availableNowCents: totals.availableCents,
      hasAvailableAccounts: hasAvailable,
      events,
      reserveCents: settings.safetyReserveCents,
      preserveBudgets: withBudgets,
      goals: goalsForSim,
      linkedGoalId: goalId,
    });
  const result = priceCents && priceCents > 0 ? simulate(priceCents, dateInput || null, goalInput || null) : null;
  const activePlans = data.purchasePlans.filter((p) => p.status === "active");
  const otherPlans = data.purchasePlans.filter((p) => p.status !== "active");

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ horizon: String(horizon), ...(scenarioParam ? { scenario: scenarioParam } : {}), ...patch });
    return `/previsions?${params.toString()}#prevision`;
  };

  return (
    <div className="stack">
      <PageHeader title="Prévisions et simulateur d'achat" subtitle="Solde disponible (comptes courants + espèces) projeté jour par jour, dans l'ordre chronologique des mouvements." />

      <section className="card stack" id="simulateur">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2>Simuler un achat</h2>
          <Badge tone="forecast">Aide à la décision</Badge>
        </div>
        <form method="get" action="/previsions#simulateur" className="form">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="nom">Achat</label>
              <input id="nom" name="nom" className="input" defaultValue={nameInput} placeholder="Ex. Ordinateur" />
            </div>
            <div className="field">
              <label htmlFor="prix">Prix (€)</label>
              <input id="prix" name="prix" className="input input-amount" inputMode="decimal" defaultValue={priceInput} placeholder="0,00" required aria-invalid={!!priceError} />
              {priceError && <span className="field-error">Prix invalide.</span>}
            </div>
            <div className="field">
              <label htmlFor="date">Date souhaitée</label>
              <input id="date" name="date" type="date" className="input" defaultValue={dateInput} min={today} />
              <span className="field-hint">Vide = aujourd&apos;hui.</span>
            </div>
            <div className="field">
              <label htmlFor="objectif">Objectif d&apos;épargne associé</label>
              <select id="objectif" name="objectif" className="select" defaultValue={goalInput}>
                <option value="">Aucun</option>
                {activeGoals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Évaluer l&apos;achat
            </button>
            {result && (
              <Link href="/previsions" className="btn btn-ghost">
                Effacer
              </Link>
            )}
          </div>
        </form>

        {result && (
          <div className="stack">
            <Notice tone={VERDICT_TONES[result.verdict]} title={VERDICT_LABELS[result.verdict]}>
              {result.verdict === "compatible" && "Vos échéances restent couvertes et la réserve de sécurité est préservée sur la période de contrôle."}
              {result.verdict !== "compatible" && result.earliestDate && result.earliestDate !== result.purchaseDate && (
                <>Première date pleinement compatible : <strong>{formatDate(result.earliestDate, "long")}</strong>.</>
              )}
              {result.reasons.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {result.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </Notice>

            {result.availableBeforeCents !== null && (
              <div className="grid-stats">
                <StatTile label="Coût de l'achat" cents={result.priceCents} />
                <StatTile label={`Disponible le ${formatDate(result.purchaseDate, "short")}, avant achat`} cents={result.availableBeforeCents} nature="forecast" />
                <StatTile label="Disponible juste après l'achat" cents={result.availableAfterCents ?? 0} nature="forecast" tone="auto" />
                <StatTile
                  label="Marge de sécurité restante"
                  cents={result.marginCents ?? 0}
                  nature="forecast"
                  tone="auto"
                  hint={
                    result.minBalanceAfter
                      ? `point bas ${formatCents(result.minBalanceAfter.balanceCents)} le ${formatDate(result.minBalanceAfter.date, "short")} − réserve ${formatCents(result.reserveCents)}`
                      : undefined
                  }
                />
              </div>
            )}

            <div className="grid-2">
              <div>
                <h3 className="small muted" style={{ marginBottom: 6 }}>
                  Échéances des 30 jours suivant l&apos;achat
                </h3>
                {result.bills.length === 0 ? (
                  <p className="faint small">Aucune échéance programmée.</p>
                ) : (
                  <ul className="list">
                    {result.bills.map((b, i) => (
                      <li key={i}>
                        <span className="list-main">
                          <span>{b.label}</span>
                          <span className="faint tiny">
                            {formatDate(b.date, "short")} · solde après : {formatCents(b.balanceAfterCents)}
                          </span>
                        </span>
                        <span className="row">
                          <Badge tone={b.covered ? "positive" : "negative"}>{b.covered ? "Couverte" : "Non couverte"}</Badge>
                          <span className="num">{formatCents(b.amountCents)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="stack-sm">
                <h3 className="small muted">Contrôles</h3>
                <p className="small">
                  {result.reserveKept ? "✓" : "✗"} Réserve de sécurité ({formatCents(result.reserveCents)}) {result.reserveKept ? "préservée" : "entamée"}
                </p>
                <p className="small">
                  {result.budgetsCompromised ? "✗ Budgets compromis" : withBudgets ? "✓ Enveloppes budgétaires préservées" : "— Enveloppes budgétaires non prises en compte (paramètres)"}
                </p>
                <p className="small">{result.dependsOnEstimatedIncome ? "✗ Dépend de revenus estimés" : "✓ Basé sur les revenus certains uniquement"}</p>
                {result.goalImpacts.length > 0 && (
                  <>
                    <h3 className="small muted" style={{ marginTop: 8 }}>
                      Objectifs d&apos;épargne
                    </h3>
                    {result.goalImpacts.map((g) => (
                      <p key={g.goalId} className="small">
                        {g.name} :{" "}
                        {g.linked && g.coveragePct !== null
                          ? `couvre déjà ${g.coveragePct.toLocaleString("fr-FR")} % du prix.`
                          : g.equivalentMonths !== null
                            ? `l'achat équivaut à ${g.equivalentMonths} mois de contribution (retard possible si l'argent est pris sur cet objectif).`
                            : "aucune contribution mensuelle définie."}
                      </p>
                    ))}
                  </>
                )}
              </div>
            </div>

            {!plan && (
              <details className="disclosure">
                <summary>Enregistrer cet achat dans ma liste</summary>
                <div style={{ marginTop: 8 }}>
                  <PurchaseForm
                    goals={activeGoals.map((g) => ({ id: g.id, name: g.name }))}
                    accounts={toAccountOptions(data.accounts)}
                    categories={toCategoryOptions(data.categories)}
                    initial={{
                      name: nameInput,
                      price: priceInput,
                      desiredDate: dateInput,
                      deadline: "",
                      priority: "2",
                      project: "",
                      accountId: "",
                      categoryId: "",
                      url: "",
                      notes: "",
                      goalId: goalInput,
                    }}
                  />
                </div>
              </details>
            )}
            <p className="faint tiny">
              Méthode : le solde disponible doit rester au-dessus de la réserve chaque jour pendant les 62 jours suivant l&apos;achat (scénario garanti :
              revenus certains seulement, toutes les sorties programmées{withBudgets ? ", enveloppes budgétaires restantes" : ""}). Il s&apos;agit d&apos;une aide à
              la décision budgétaire, pas d&apos;une garantie de solvabilité.
            </p>
          </div>
        )}
      </section>

      <section className="card stack" id="prevision">
        <div className="row-between">
          <h2>Solde disponible prévu</h2>
          <div className="row">
            {HORIZONS.map((h) => (
              <Link key={h} href={href({ horizon: String(h) })} className={`btn btn-sm ${h === horizon ? "" : "btn-ghost"}`}>
                {h === 365 ? "1 an" : `${h} j`}
              </Link>
            ))}
          </div>
        </div>
        {hasProbable && (
          <div className="row">
            <Link href={href({ scenario: "garanti" })} className={`btn btn-sm ${!showEstimated ? "" : "btn-ghost"}`}>
              Garanti
            </Link>
            <Link href={href({ scenario: "estime" })} className={`btn btn-sm ${showEstimated ? "" : "btn-ghost"}`}>
              Estimé
            </Link>
          </div>
        )}
        {!hasAvailable ? (
          <p className="muted small">Ajoutez un compte courant ou des espèces pour obtenir une prévision.</p>
        ) : (
          <>
            <div className="grid-stats">
              <StatTile label="Disponible aujourd'hui" cents={totals.availableCents} nature="actual" />
              <StatTile
                label="Point le plus bas"
                cents={low?.balanceCents ?? 0}
                nature="forecast"
                tone="auto"
                hint={low ? `le ${formatDate(low.date, "short")}` : undefined}
              />
              <StatTile label={`Dans ${horizon} jours`} cents={main.at(-1)?.balanceCents ?? 0} nature="forecast" tone="auto" />
              <StatTile
                label="Prochain revenu"
                text={income ? formatCents(income.grossCents) : "—"}
                nature={income?.certainty === "certain" ? "forecast" : "estimate"}
                hint={income ? `${income.label}, le ${formatDate(income.date, "short")}` : "Aucun revenu programmé"}
              />
            </div>
            <LineChart
              ariaLabel="Projection du solde disponible"
              labels={main.map((p) => formatDate(p.date, "short"))}
              series={[
                { id: "guaranteed", label: "Garanti (revenus certains)", slot: 1, values: guaranteed.map((p) => p.balanceCents) },
                ...(hasProbable ? [{ id: "estimated", label: "Estimé (+ revenus probables)", slot: 2 as const, dashed: true, values: estimated.map((p) => p.balanceCents) }] : []),
              ]}
              threshold={settings.safetyReserveCents > 0 ? { value: settings.safetyReserveCents, label: "Réserve de sécurité" } : undefined}
              height={240}
              tableStep={horizon > 90 ? 7 : 1}
            />
            {uncertain.length > 0 && (
              <p className="faint small">
                Non comptés (incertains) : {uncertain.map((e) => `${e.label} ${formatCents(e.grossCents)} le ${formatDate(e.date, "short")}`).join(" · ")}.
              </p>
            )}
            {events.some((e) => e.overdue) && (
              <p className="faint small">
                Les échéances passées non confirmées sont reportées à aujourd&apos;hui.{" "}
                <Link href="/calendrier" className="link">
                  Les confirmer
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Mouvements prévus (60 jours)</h2>
          <span className="faint small">{showEstimated ? "Scénario estimé" : "Scénario garanti"}</span>
        </div>
        {shown.length === 0 ? (
          <p className="muted small">Aucun mouvement programmé : ajoutez vos revenus et charges récurrents dans le calendrier.</p>
        ) : (
          <ul className="list">
            {shown.map((e, i) => (
              <li key={i}>
                <span className="list-main">
                  <span>{e.source === "budget" ? `Enveloppe ${categoriesById.get(e.categoryId ?? "")?.name ?? "budget"}` : e.label}</span>
                  <span className="faint tiny">
                    {formatDate(e.date, "short")}
                    {e.overdue && ` (prévu le ${formatDate(e.originalDate, "short")})`} · {SOURCE_LABELS[e.source]}
                    {e.deltaCents > 0 && ` · ${CERTAINTY_LABELS[e.certainty]}`}
                  </span>
                </span>
                <span className="stack-sm" style={{ alignItems: "flex-end", gap: 0 }}>
                  <Amount cents={e.deltaCents} signed colored />
                  <span className="faint tiny num">solde {formatCents(balanceAfter.get(e) ?? 0)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Achats envisagés (évalués un par un)</h2>
          <Link href="/achats" className="link small">
            Calendrier d&apos;achat cumulé →
          </Link>
        </div>
        <p className="faint small" style={{ marginBottom: 8 }}>
          Ici, chaque achat est évalué isolément. Pour une liste (emménagement…), la page « Achats planifiés » tient compte de tous les achats ensemble.
        </p>
        {activePlans.length === 0 ? (
          <p className="muted small">Aucun achat envisagé. Simulez un achat puis enregistrez-le pour suivre le moment où il devient raisonnable.</p>
        ) : (
          <ul className="list">
            {activePlans.map((p) => {
              const r = simulate(p.priceCents, p.desiredDate, p.goalId);
              return (
                <li key={p.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <div className="row-between">
                    <Link href={`/previsions?achat=${p.id}#simulateur`} className="list-main">
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span className="faint tiny">
                        Priorité {PRIORITY_LABELS[p.priority].toLowerCase()}
                        {p.desiredDate ? ` · souhaité le ${formatDate(p.desiredDate, "short")}` : ""}
                        {r.earliestDate ? ` · possible dès le ${formatDate(r.earliestDate, "short")}` : ""}
                      </span>
                    </Link>
                    <span className="row">
                      <Badge tone={r.verdict === "compatible" ? "positive" : r.verdict === "reduced_margin" ? "estimate" : r.verdict === "postpone" ? "negative" : "default"}>
                        {r.verdict === "compatible" ? "Compatible" : r.verdict === "reduced_margin" ? "Marge réduite" : r.verdict === "postpone" ? "À reporter" : "Données insuffisantes"}
                      </Badge>
                      <span className="num">{formatCents(p.priceCents)}</span>
                    </span>
                  </div>
                  <div className="row">
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                        Lien
                      </a>
                    )}
                    <ActionButton action={setPurchaseStatusAction} fields={{ id: p.id, status: "purchased" }} className="btn btn-sm">
                      <Icon name="check" size={14} /> Acheté
                    </ActionButton>
                    <ActionButton action={setPurchaseStatusAction} fields={{ id: p.id, status: "abandoned" }} className="btn btn-ghost btn-sm">
                      Abandonner
                    </ActionButton>
                    <ActionButton action={deletePurchasePlanAction} fields={{ id: p.id }} className="btn btn-ghost btn-sm" confirm={`Supprimer « ${p.name} » ?`}>
                      <Icon name="trash" size={14} />
                    </ActionButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {otherPlans.length > 0 && (
          <details className="disclosure" style={{ marginTop: 8 }}>
            <summary>Achats effectués ou abandonnés ({otherPlans.length})</summary>
            <ul className="list">
              {otherPlans.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.name} <span className="faint tiny">· {p.status === "purchased" ? "acheté" : "abandonné"}</span>
                  </span>
                  <span className="row">
                    <span className="num faint">{formatCents(p.priceCents)}</span>
                    <ActionButton action={setPurchaseStatusAction} fields={{ id: p.id, status: "active" }} className="btn btn-ghost btn-sm">
                      Réactiver
                    </ActionButton>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
