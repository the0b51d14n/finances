import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { deleteRuleAction, toggleRuleAction } from "@/app/actions/ledger";
import { OccurrenceResolver } from "@/components/forms/OccurrenceResolver";
import { RuleForm } from "@/components/forms/RuleForm";
import { toAccountOptions, toCategoryOptions } from "@/components/forms/options";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Amount, Badge, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { addDays, addMonths, formatDate, maxDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { FREQUENCY_LABELS, OCCURRENCE_STATUS_LABELS, listOccurrences, monthlyEquivalentCents, realizationIndex } from "@/lib/domain/recurrence";
import { centsToInput, formatCents } from "@/lib/money";
import { CERTAINTY_LABELS, KIND_LABELS } from "@/lib/view/labels";

export const metadata: Metadata = { title: "Échéance récurrente" };

export default function RulePage(props: PageProps<"/calendrier/regles/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={2} />}>
      <Rule params={props.params} />
    </Suspense>
  );
}

async function Rule({ params }: { params: PageProps<"/calendrier/regles/[id]">["params"] }) {
  const { id } = await params;
  const data = await loadFinanceData();
  const rule = data.rules.find((r) => r.id === id);
  if (!rule) notFound();

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const category = rule.categoryId ? data.categories.find((c) => c.id === rule.categoryId) : undefined;
  const index = realizationIndex(data.transactions);
  const from = maxDate(rule.startDate, addMonths(data.today, -12));
  const occurrences = listOccurrences(rule, from, addMonths(data.today, 6), data.today, index).reverse();
  const realized = data.transactions.filter((t) => t.recurrenceId === rule.id && t.status === "confirmed");
  const totalRealized = realized.reduce((s, t) => s + t.amountCents, 0);

  return (
    <div className="stack">
      <PageHeader
        title={rule.label}
        subtitle={`${KIND_LABELS[rule.kind]} · ${FREQUENCY_LABELS[rule.frequency]} · ${rule.isActive ? "active" : "suspendue"}`}
        back={{ href: "/calendrier", label: "Calendrier" }}
      />

      <section className="card stack-sm">
        <div className="row-between">
          <div style={{ fontSize: "1.6rem", fontWeight: 650 }}>
            <Amount cents={rule.kind === "expense" ? -rule.amountCents : rule.amountCents} signed={rule.kind !== "transfer"} />
          </div>
          <Badge tone="estimate">Montant estimé</Badge>
        </div>
        <dl className="form-grid small" style={{ margin: 0 }}>
          <div>
            <dt className="faint">Compte</dt>
            <dd style={{ margin: 0 }}>
              {accountsById.get(rule.accountId)?.name}
              {rule.toAccountId && ` → ${accountsById.get(rule.toAccountId)?.name}`}
            </dd>
          </div>
          <div>
            <dt className="faint">Catégorie</dt>
            <dd style={{ margin: 0 }}>{category?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="faint">Période</dt>
            <dd style={{ margin: 0 }}>
              depuis le {formatDate(rule.startDate)}
              {rule.endDate ? ` jusqu'au ${formatDate(rule.endDate)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="faint">Suivi depuis</dt>
            <dd style={{ margin: 0 }}>{formatDate(rule.trackingStart)}</dd>
          </div>
          <div>
            <dt className="faint">Équivalent mensuel</dt>
            <dd className="num" style={{ margin: 0 }}>{formatCents(monthlyEquivalentCents(rule.amountCents, rule.frequency))}</dd>
          </div>
          {rule.kind !== "expense" && (
            <div>
              <dt className="faint">Certitude</dt>
              <dd style={{ margin: 0 }}>{CERTAINTY_LABELS[rule.certainty]}</dd>
            </div>
          )}
          <div>
            <dt className="faint">Total réalisé</dt>
            <dd className="num" style={{ margin: 0 }}>
              {formatCents(totalRealized)} ({realized.length} fois)
            </dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Échéances (12 mois passés, 6 à venir)</h2>
        </div>
        <ul className="list">
          {occurrences.map((occ) => (
            <li key={occ.date} style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div className="row-between">
                <span className="list-main">
                  <span>{formatDate(occ.date)}</span>
                  {occ.transaction && occ.transaction.date !== occ.date && (
                    <span className="faint tiny">enregistrée le {formatDate(occ.transaction.date)}</span>
                  )}
                </span>
                <span className="row">
                  <Badge tone={occ.status === "realized" ? "positive" : occ.status === "overdue" ? "estimate" : occ.status === "pending" ? "forecast" : "default"}>
                    {OCCURRENCE_STATUS_LABELS[occ.status]}
                  </Badge>
                  {occ.transaction ? (
                    <Link href={`/operations/${occ.transaction.id}`} className="link num">
                      {formatCents(occ.transaction.amountCents)}
                    </Link>
                  ) : (
                    <span className="num faint">{formatCents(rule.amountCents)}</span>
                  )}
                </span>
              </div>
              {(occ.status === "overdue" || (occ.status === "pending" && occ.date <= addDays(data.today, 7))) && (
                <OccurrenceResolver ruleId={rule.id} occurrenceDate={occ.date} amount={centsToInput(rule.amountCents)} today={data.today} />
              )}
            </li>
          ))}
        </ul>
      </section>

      <details className="disclosure card">
        <summary>Modifier l&apos;échéance récurrente</summary>
        <p className="faint small" style={{ margin: "8px 0" }}>
          Les modifications ne touchent jamais les échéances déjà enregistrées. Pour un changement à partir d&apos;une date (nouveau loyer…), utilisez
          « Appliquer seulement à partir du » dans les options avancées.
        </p>
        <RuleForm
          accounts={toAccountOptions(data.accounts)}
          categories={toCategoryOptions(data.categories)}
          returnTo={`/calendrier/regles/${rule.id}`}
          initial={{
            id: rule.id,
            kind: rule.kind,
            label: rule.label,
            amount: centsToInput(rule.amountCents),
            accountId: rule.accountId,
            toAccountId: rule.toAccountId ?? "",
            categoryId: rule.categoryId ?? "",
            frequency: rule.frequency,
            startDate: rule.startDate,
            endDate: rule.endDate ?? "",
            trackingStart: rule.trackingStart,
            certainty: rule.certainty,
            isActive: rule.isActive,
            notes: rule.notes ?? "",
          }}
        />
      </details>

      <section className="row">
        <ActionButton action={toggleRuleAction} fields={{ id: rule.id, active: rule.isActive ? "0" : "1" }} className="btn">
          {rule.isActive ? "Suspendre" : "Réactiver"}
        </ActionButton>
        <ActionButton
          action={deleteRuleAction}
          fields={{ id: rule.id }}
          className="btn btn-danger"
          confirm="Supprimer cette échéance récurrente ? Les opérations déjà enregistrées sont conservées (détachées de la règle)."
        >
          <Icon name="trash" size={16} /> Supprimer
        </ActionButton>
      </section>
    </div>
  );
}
