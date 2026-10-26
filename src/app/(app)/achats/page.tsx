import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { deletePurchasePlanAction, setPurchaseStatusAction } from "@/app/actions/planning";
import { LineChart } from "@/components/charts/LineChart";
import { PurchaseForm } from "@/components/forms/PlanningForms";
import { toAccountOptions, toCategoryOptions } from "@/components/forms/options";
import { TransferSuggestions } from "@/components/ledger/TransferSuggestions";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Badge, EmptyState, Notice, PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import { addDays, formatDate, maxDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { balancesAt, totalsByClass } from "@/lib/domain/accounts";
import { forecastEventsFor, horizonEnd } from "@/lib/domain/dashboard";
import { includeEvent, minBalance, projectDaily } from "@/lib/domain/forecast";
import { PRIORITY_LABELS } from "@/lib/domain/goals";
import { planPurchases, type PlanItem, type PlanStatus } from "@/lib/domain/planner";
import { SIMULATION_WINDOW_DAYS } from "@/lib/domain/simulator";
import { suggestTransfers } from "@/lib/domain/transfers";
import { centsToInput, formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "Achats planifiés" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const STATUS_BADGES: Record<PlanStatus, { tone: "positive" | "estimate" | "negative"; label: string }> = {
  scheduled: { tone: "positive", label: "Planifié" },
  late: { tone: "estimate", label: "Après la date limite" },
  unschedulable: { tone: "negative", label: "Hors de portée (12 mois)" },
};

export default function PurchasesPage(props: PageProps<"/achats">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Purchases searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Purchases({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const data = await loadFinanceData();
  const { today, settings } = data;
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const balances = balancesAt(data.accounts, data.transactions, today);
  const totals = totalsByClass(data.accounts, balances);
  const events = forecastEventsFor(data);
  const end = horizonEnd(today);

  const active = data.purchasePlans.filter((p) => p.status === "active");
  const projects = [...new Set(data.purchasePlans.map((p) => p.project).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, "fr"));
  const project = projects.includes(one(sp.projet)) ? one(sp.projet) : "";
  const selected = project ? active.filter((p) => p.project === project) : active;

  // Les achats des autres projets restent engagés : ils sont planifiés aussi,
  // mais seuls ceux du projet choisi sont affichés.
  const items: PlanItem[] = active.map((p, i) => ({
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    priority: p.priority,
    notBefore: p.desiredDate,
    deadline: p.deadline,
    accountId: p.accountId ?? settings.spendingAccountId,
    categoryId: p.categoryId,
    order: i,
  }));
  const plan = planPurchases({
    today,
    horizonEnd: end,
    availableNowCents: totals.availableCents,
    events,
    reserveCents: settings.safetyReserveCents,
    preserveBudgets: settings.preserveBudgetsInForecast,
    items,
  });
  const shown = plan.entries.filter((e) => selected.some((p) => p.id === e.item.id));
  const plansById = new Map(active.map((p) => [p.id, p]));
  const selectedTotal = selected.reduce((s, p) => s + p.priceCents, 0);
  const lastDate = shown.filter((e) => e.date).reduce<string | null>((m, e) => (!m || e.date! > m ? e.date! : m), null);
  const problems = shown.filter((e) => e.status !== "scheduled");

  // Virements à prévoir en tenant compte des achats planifiés.
  const transfers = suggestTransfers({
    today,
    accounts: data.accounts,
    balances,
    events: [...events, ...plan.purchaseEvents],
    withBudgets: settings.preserveBudgetsInForecast,
    lookaheadDays: 62,
  });

  // Courbe : disponible prévu avec et sans les achats planifiés.
  const chartEnd = maxDate(addDays(today, 90), lastDate ? addDays(lastDate, SIMULATION_WINDOW_DAYS) : today);
  const filter = (e: Parameters<typeof includeEvent>[0]) => includeEvent(e, "guaranteed", settings.preserveBudgetsInForecast);
  const without = projectDaily(totals.availableCents, events, today, chartEnd, filter);
  const withPurchases = projectDaily(totals.availableCents, [...events, ...plan.purchaseEvents], today, chartEnd, filter);
  const lowWith = minBalance(withPurchases, today, chartEnd);

  const accountOptions = toAccountOptions(data.accounts);
  const categoryOptions = toCategoryOptions(data.categories);
  const goals = data.goals.filter((g) => !g.archivedAt).map((g) => ({ id: g.id, name: g.name }));
  const furniture = data.categories.find((c) => c.systemKey === "home_furnishing");
  const done = data.purchasePlans.filter((p) => p.status !== "active" && (!project || p.project === project));

  return (
    <div className="stack">
      <PageHeader
        title="Achats planifiés"
        subtitle="Listez vos achats (logement, équipement…) : l'application calcule la première date raisonnable pour chacun, en tenant compte des précédents."
      />

      {projects.length > 0 && (
        <nav className="row" aria-label="Projets">
          <Link href="/achats" className={`btn btn-sm ${project ? "btn-ghost" : ""}`}>
            Tous
          </Link>
          {projects.map((p) => (
            <Link key={p} href={`/achats?projet=${encodeURIComponent(p)}`} className={`btn btn-sm ${project === p ? "" : "btn-ghost"}`}>
              {p}
            </Link>
          ))}
        </nav>
      )}

      {selected.length === 0 ? (
        <div className="card">
          <EmptyState icon="list" title="Aucun achat planifié">
            Ajoutez ci-dessous les achats de votre emménagement (lit, réfrigérateur, table…) avec leur priorité et, si besoin, une date limite.
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="grid-stats">
            <StatTile label={project ? `Total « ${project} »` : "Total de la liste"} cents={selectedTotal} />
            <StatTile label="Disponible aujourd'hui" cents={totals.availableCents} nature="actual" hint="Les deux comptes courants" />
            <StatTile
              label="Tout acheté au plus tôt le"
              text={problems.some((p) => p.status === "unschedulable") ? "Non atteignable" : lastDate ? formatDate(lastDate) : "—"}
              nature="forecast"
            />
            <StatTile
              label="Point le plus bas après achats"
              cents={lowWith?.balanceCents ?? 0}
              nature="forecast"
              tone="auto"
              hint={lowWith ? `le ${formatDate(lowWith.date, "short")} · réserve ${formatCents(settings.safetyReserveCents)}` : undefined}
            />
          </section>

          {problems.length > 0 && (
            <Notice tone="warning" title={`${problems.length} achat(s) ne tiennent pas dans les délais souhaités`}>
              Réduisez un prix, abaissez une priorité, décalez une date limite, ou prévoyez une rentrée d&apos;argent. Le manque indiqué est la somme qu&apos;il
              faudrait en plus pour acheter à la date limite sans entamer la réserve.
            </Notice>
          )}

          <section className="card">
            <div className="card-header">
              <h2>Calendrier d&apos;achat conseillé</h2>
              <span className="faint small">Scénario garanti</span>
            </div>
            <ul className="list">
              {shown.map((entry) => {
                const p = plansById.get(entry.item.id)!;
                const badge = STATUS_BADGES[entry.status];
                const payer = entry.item.accountId ? accountsById.get(entry.item.accountId)?.name : null;
                return (
                  <li key={p.id} id={`achat-${p.id}`} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                    <div className="row-between" style={{ alignItems: "flex-start" }}>
                      <span className="list-main">
                        <span style={{ fontWeight: 600 }}>
                          {entry.date ? formatDate(entry.date, "short") : "—"} · {p.name}
                        </span>
                        <span className="faint tiny">
                          Priorité {PRIORITY_LABELS[p.priority].toLowerCase()}
                          {p.desiredDate && ` · pas avant le ${formatDate(p.desiredDate, "short")}`}
                          {p.deadline && ` · au plus tard le ${formatDate(p.deadline, "short")}`}
                          {payer && ` · payé par ${payer}`}
                          {p.categoryId && ` · ${categoriesById.get(p.categoryId)?.name}`}
                          {p.project && !project && ` · ${p.project}`}
                        </span>
                        {entry.date && (
                          <span className="faint tiny num">
                            Cumul {formatCents(entry.cumulativeCents)} · disponible après {formatCents(entry.availableAfterCents ?? 0)}
                          </span>
                        )}
                        {entry.deadlineShortfallCents !== null && entry.deadlineShortfallCents > 0 && (
                          <span className="tiny neg">Il manquerait {formatCents(entry.deadlineShortfallCents)} pour l&apos;acheter à la date limite.</span>
                        )}
                      </span>
                      <span className="stack-sm" style={{ alignItems: "flex-end", gap: 4 }}>
                        <span className="num" style={{ fontWeight: 600 }}>
                          {formatCents(p.priceCents)}
                        </span>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </span>
                    </div>
                    <div className="row">
                      <Link href={`/operations/nouvelle?achat=${p.id}&retour=/achats`} className="btn btn-primary btn-sm">
                        <Icon name="check" size={14} /> Acheté
                      </Link>
                      <Link href={`/previsions?achat=${p.id}#simulateur`} className="btn btn-sm">
                        Simuler seul
                      </Link>
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                          Lien
                        </a>
                      )}
                      <ActionButton action={setPurchaseStatusAction} fields={{ id: p.id, status: "abandoned" }} className="btn btn-ghost btn-sm">
                        Abandonner
                      </ActionButton>
                      <ActionButton action={deletePurchasePlanAction} fields={{ id: p.id }} className="btn btn-ghost btn-sm" confirm={`Supprimer « ${p.name} » ?`}>
                        <Icon name="trash" size={14} />
                      </ActionButton>
                    </div>
                    <details className="disclosure">
                      <summary>Modifier</summary>
                      <div style={{ marginTop: 8 }}>
                        <PurchaseForm
                          goals={goals}
                          accounts={accountOptions}
                          categories={categoryOptions}
                          projects={projects}
                          returnTo={`/achats${project ? `?projet=${encodeURIComponent(project)}` : ""}#achat-${p.id}`}
                          initial={{
                            id: p.id,
                            name: p.name,
                            price: centsToInput(p.priceCents),
                            desiredDate: p.desiredDate ?? "",
                            deadline: p.deadline ?? "",
                            priority: String(p.priority),
                            project: p.project ?? "",
                            accountId: p.accountId ?? "",
                            categoryId: p.categoryId ?? "",
                            url: p.url ?? "",
                            notes: p.notes ?? "",
                            goalId: p.goalId ?? "",
                          }}
                        />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Disponible prévu avec et sans ces achats</h2>
            </div>
            <LineChart
              ariaLabel="Solde disponible prévu avec et sans les achats planifiés"
              labels={withPurchases.map((p) => formatDate(p.date, "short"))}
              series={[
                { id: "without", label: "Sans les achats", slot: 1, dashed: true, values: without.map((p) => p.balanceCents) },
                { id: "with", label: "Avec les achats planifiés", slot: 2, values: withPurchases.map((p) => p.balanceCents) },
              ]}
              threshold={settings.safetyReserveCents > 0 ? { value: settings.safetyReserveCents, label: "Réserve de sécurité" } : undefined}
              tableStep={7}
            />
          </section>
        </>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Virements conseillés</h2>
          <span className="faint small">62 prochains jours, achats compris</span>
        </div>
        {!settings.spendingAccountId && (
          <p className="faint small" style={{ marginBottom: 8 }}>
            Astuce : choisissez votre compte de dépenses dans{" "}
            <Link href="/parametres" className="link">
              Paramètres
            </Link>{" "}
            pour que les achats et les budgets y soient imputés par défaut.
          </p>
        )}
        <TransferSuggestions
          suggestions={transfers}
          accountsById={accountsById}
          returnTo="/achats"
          emptyText="Aucun virement nécessaire : chaque compte courant reste positif."
        />
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Ajouter un achat</h2>
        </div>
        <PurchaseForm
          goals={goals}
          accounts={accountOptions}
          categories={categoryOptions}
          projects={projects}
          returnTo={project ? `/achats?projet=${encodeURIComponent(project)}` : "/achats"}
          initial={{
            name: "",
            price: "",
            desiredDate: "",
            deadline: "",
            priority: "2",
            project: project || projects[0] || "",
            accountId: "",
            categoryId: furniture?.id ?? "",
            url: "",
            notes: "",
            goalId: "",
          }}
        />
      </section>

      <details className="disclosure card">
        <summary>Comment le calendrier est calculé</summary>
        <div className="stack-sm small muted" style={{ marginTop: 8 }}>
          <p>
            Les achats sont traités par priorité, puis par date limite. Chacun est placé au premier jour où vos deux comptes courants réunis restent
            au-dessus de la réserve de sécurité pendant les 62 jours suivants, en tenant compte de vos revenus certains, de vos échéances, de vos
            enveloppes budgétaires et de tous les achats déjà placés. Les livrets ne sont jamais utilisés.
          </p>
          <p>
            Frais à date fixe (premier loyer, assurance habitation, ouverture d&apos;électricité) : enregistrez-les comme opérations « prévues », ils sont
            intégrés au calcul. Le dépôt de garantie vous sera rendu : créez un compte « Dépôt de garantie » de type « Autre réserve » et enregistrez
            un transfert prévu vers ce compte. Votre total des soldes ne baisse pas, mais votre disponible si.
          </p>
        </div>
      </details>

      {done.length > 0 && (
        <details className="disclosure card">
          <summary>Achats effectués ou abandonnés ({done.length})</summary>
          <ul className="list">
            {done.map((p) => (
              <li key={p.id}>
                <span>
                  {p.name} <span className="faint tiny">· {p.status === "purchased" ? "acheté" : "abandonné"}</span>
                </span>
                <span className="row">
                  <span className="num faint">{formatCents(p.priceCents)}</span>
                  <ActionButton action={setPurchaseStatusAction} fields={{ id: p.id, status: "active" }} className="btn btn-ghost btn-sm">
                    Remettre dans la liste
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
