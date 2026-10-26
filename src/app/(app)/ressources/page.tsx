import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, EmptyState, PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import { addMonths, formatDate, maxDate, monthKeyOf, startOfMonth } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { balancesAt } from "@/lib/domain/accounts";
import { FREQUENCY_LABELS, OCCURRENCE_STATUS_LABELS, listOccurrences, nextOccurrence, realizationIndex } from "@/lib/domain/recurrence";
import { formatCents } from "@/lib/money";
import { CERTAINTY_LABELS } from "@/lib/view/labels";

export const metadata: Metadata = { title: "Ressources et avantages" };

export default function ResourcesPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Resources />
    </Suspense>
  );
}

async function Resources() {
  const data = await loadFinanceData();
  const { today } = data;
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const balances = balancesAt(data.accounts, data.transactions, today);
  const index = realizationIndex(data.transactions);
  const incomeRules = data.rules.filter((r) => r.kind === "income");
  const vouchers = data.accounts.filter((a) => a.type === "meal_voucher");
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const monthStart = startOfMonth(monthKeyOf(today));

  // Estimé vs reçu pour les échéances de revenus réalisées ce mois-ci.
  const realizedThisMonth = data.transactions.filter(
    (t) => t.kind === "income" && t.status === "confirmed" && t.recurrenceId && t.date >= monthStart && t.date <= today,
  );
  const expectedThisMonth = realizedThisMonth.reduce((s, t) => s + (t.expectedAmountCents ?? t.amountCents), 0);
  const receivedThisMonth = realizedThisMonth.reduce((s, t) => s + t.amountCents, 0);

  const incomeByCategory = new Map<string, number>();
  for (const t of data.transactions) {
    if (t.kind !== "income" || t.status !== "confirmed" || t.date < yearStart) continue;
    const key = t.categoryId ?? "";
    incomeByCategory.set(key, (incomeByCategory.get(key) ?? 0) + t.amountCents);
  }

  return (
    <div className="stack">
      <PageHeader
        title="Ressources et avantages"
        subtitle="Salaires, aides et avantages : montants estimés et sommes réellement reçues."
        actions={
          <Link href="/calendrier/regles/nouvelle?type=income&retour=/ressources" className="btn btn-primary">
            <Icon name="plus" size={16} /> Ressource récurrente
          </Link>
        }
      />

      <section className="grid-stats">
        <StatTile label="Estimé (échéances reçues ce mois)" cents={expectedThisMonth} nature="estimate" />
        <StatTile label="Réellement reçu ce mois" cents={receivedThisMonth} nature="actual" hint={expectedThisMonth ? `écart ${formatCents(receivedThisMonth - expectedThisMonth, { signed: true })}` : undefined} />
        <StatTile label={`Revenus confirmés ${today.slice(0, 4)}`} cents={[...incomeByCategory.values()].reduce((a, b) => a + b, 0)} nature="actual" />
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Revenus et aides récurrents</h2>
        </div>
        {incomeRules.length === 0 ? (
          <EmptyState icon="gift" title="Aucune ressource récurrente">
            Ajoutez votre salaire d&apos;alternance, votre job étudiant, l&apos;APL, la prime d&apos;activité… en précisant leur niveau de certitude : une aide
            incertaine n&apos;est jamais considérée comme de l&apos;argent garanti.
          </EmptyState>
        ) : (
          <div className="stack">
            {incomeRules.map((rule) => {
              const occurrences = listOccurrences(rule, maxDate(rule.startDate, addMonths(today, -6)), addMonths(today, 2), today, index)
                .filter((o) => o.status !== "untracked")
                .reverse()
                .slice(0, 8);
              const next = rule.isActive ? nextOccurrence(rule, today) : null;
              return (
                <div key={rule.id} className="stack-sm" style={{ borderBottom: "1px solid var(--border-soft)", paddingBottom: 12 }}>
                  <div className="row-between">
                    <Link href={`/calendrier/regles/${rule.id}`} className="list-main">
                      <span style={{ fontWeight: 600 }}>{rule.label}</span>
                      <span className="faint tiny">
                        {rule.categoryId ? categoriesById.get(rule.categoryId)?.name : ""} · {FREQUENCY_LABELS[rule.frequency]} · vers{" "}
                        {accountsById.get(rule.accountId)?.name}
                        {next ? ` · prochaine le ${formatDate(next, "short")}` : rule.isActive ? "" : " · suspendue"}
                      </span>
                    </Link>
                    <span className="row">
                      <Badge tone={rule.certainty === "certain" ? "positive" : "estimate"}>{CERTAINTY_LABELS[rule.certainty]}</Badge>
                      <span className="num">{formatCents(rule.amountCents)}</span>
                    </span>
                  </div>
                  {occurrences.length > 0 && (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Prévu le</th>
                            <th className="r">Estimé</th>
                            <th>Reçu le</th>
                            <th className="r">Reçu</th>
                            <th>Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {occurrences.map((o) => (
                            <tr key={o.date}>
                              <td>{formatDate(o.date, "short")}</td>
                              <td className="r num faint">{formatCents(o.transaction?.expectedAmountCents ?? rule.amountCents)}</td>
                              <td>{o.transaction && o.status === "realized" ? formatDate(o.transaction.date, "short") : "—"}</td>
                              <td className="r num">{o.transaction && o.status === "realized" ? formatCents(o.transaction.amountCents) : "—"}</td>
                              <td>
                                <span className="small">{OCCURRENCE_STATUS_LABELS[o.status]}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Tickets-restaurant</h2>
          <Link href="/comptes/nouveau" className="link small">
            Ajouter un portefeuille
          </Link>
        </div>
        {vouchers.length === 0 ? (
          <p className="muted small">
            Aucun portefeuille de tickets-restaurant. Créez un compte de type « Tickets-restaurant » : ses crédits sont saisis comme des revenus (catégorie
            « Tickets-restaurant (crédits) ») et vos achats peuvent être payés en partie avec, sans débiter une seconde fois votre banque.
          </p>
        ) : (
          <ul className="list">
            {vouchers.map((v) => {
              const monthTx = data.transactions.filter((t) => t.status === "confirmed" && t.date >= monthStart && t.entries.some((e) => e.accountId === v.id));
              const credits = monthTx.reduce((s, t) => s + Math.max(0, t.entries.find((e) => e.accountId === v.id)!.amountCents), 0);
              const spent = monthTx.reduce((s, t) => s - Math.min(0, t.entries.find((e) => e.accountId === v.id)!.amountCents), 0);
              return (
                <li key={v.id}>
                  <Link href={`/comptes/${v.id}`} className="list-link">
                    <span className="list-main">
                      <span style={{ fontWeight: 500 }}>{v.name}</span>
                      <span className="faint tiny">
                        Ce mois : +{formatCents(credits)} reçus, −{formatCents(spent)} dépensés
                        {v.validUntil ? ` · valables jusqu'au ${formatDate(v.validUntil, "short")}` : ""}
                      </span>
                    </span>
                    <Amount cents={balances.get(v.id) ?? 0} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="faint tiny" style={{ marginTop: 8 }}>
          Le solde de tickets est une ressource affectée à l&apos;alimentation : il n&apos;est compté ni dans l&apos;argent disponible ni dans le total des soldes.
          L&apos;éligibilité d&apos;un achat aux tickets est à votre appréciation lors de la saisie.
        </p>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Revenus confirmés par catégorie ({today.slice(0, 4)})</h2>
        </div>
        {incomeByCategory.size === 0 ? (
          <p className="muted small">Aucun revenu confirmé cette année.</p>
        ) : (
          <ul className="list">
            {[...incomeByCategory.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([id, cents]) => (
                <li key={id || "none"}>
                  <span>{categoriesById.get(id)?.name ?? "Sans catégorie"}</span>
                  <Amount cents={cents} />
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
