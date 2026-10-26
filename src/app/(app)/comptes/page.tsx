import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/ui/Icon";
import { Amount, EmptyState, PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { ACCOUNT_CLASS_LABELS, ACCOUNT_TYPE_LABELS, accountClass, balancesAt, totalsByClass } from "@/lib/domain/accounts";
import type { AccountClass } from "@/lib/domain/types";
import { formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "Comptes" };

export default function AccountsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Accounts />
    </Suspense>
  );
}

const CLASS_ORDER: AccountClass[] = ["available", "savings", "reserve", "voucher"];

async function Accounts() {
  const data = await loadFinanceData();
  const balances = balancesAt(data.accounts, data.transactions, data.today);
  const active = data.accounts.filter((a) => !a.archivedAt);
  const archived = data.accounts.filter((a) => a.archivedAt);
  const totals = totalsByClass(active, balances);
  const plannedByAccount = new Map<string, number>();
  for (const tx of data.transactions) {
    if (tx.status !== "planned") continue;
    for (const e of tx.entries) plannedByAccount.set(e.accountId, (plannedByAccount.get(e.accountId) ?? 0) + e.amountCents);
  }

  // Regroupement par banque dès qu'une banque est renseignée, sinon par classe comptable.
  const byBank = active.some((a) => a.institution);
  const groups = byBank
    ? [...new Set(active.map((a) => a.institution ?? ""))]
        .sort((x, y) => (x === "" ? 1 : y === "" ? -1 : x.localeCompare(y, "fr")))
        .map((bank) => ({
          key: bank || "none",
          title: bank || "Sans banque",
          list: active
            .filter((a) => (a.institution ?? "") === bank)
            .sort((x, y) => CLASS_ORDER.indexOf(accountClass(x.type)) - CLASS_ORDER.indexOf(accountClass(y.type))),
        }))
    : CLASS_ORDER.map((cls) => ({ key: cls, title: ACCOUNT_CLASS_LABELS[cls], list: active.filter((a) => accountClass(a.type) === cls) }));

  return (
    <div className="stack">
      <PageHeader
        title="Comptes"
        subtitle="Soldes calculés à partir du solde initial et des opérations confirmées."
        actions={
          <Link href="/comptes/nouveau" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nouveau compte
          </Link>
        }
      />

      {active.length === 0 ? (
        <div className="card">
          <EmptyState icon="wallet" title="Aucun compte" action={<Link href="/comptes/nouveau" className="btn btn-primary">Créer un compte</Link>}>
            Créez vos comptes courants, livrets, espèces et portefeuille de tickets-restaurant.
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="grid-stats">
            <StatTile label="Total des soldes" cents={totals.totalCents} nature="actual" hint="Hors tickets-restaurant" />
            <StatTile label="Disponible" cents={totals.availableCents} nature="actual" />
            <StatTile label="Épargne" cents={totals.savingsCents} nature="actual" />
            {totals.voucherCents !== 0 && <StatTile label="Tickets-restaurant" cents={totals.voucherCents} nature="actual" />}
          </section>

          {groups.map(({ key, title, list }) => {
            if (list.length === 0) return null;
            const groupTotal = list.filter((a) => accountClass(a.type) !== "voucher").reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
            return (
              <section key={key} className="card">
                <div className="card-header">
                  <h2>{title}</h2>
                  {byBank && <span className="num small muted">{formatCents(groupTotal)}</span>}
                </div>
                <ul className="list">
                  {list.map((a) => {
                    const planned = plannedByAccount.get(a.id) ?? 0;
                    return (
                      <li key={a.id}>
                        <Link href={`/comptes/${a.id}`} className="list-link">
                          <span className="list-main">
                            <span style={{ fontWeight: 500 }}>{a.name}</span>
                            <span className="faint tiny">
                              {ACCOUNT_TYPE_LABELS[a.type]}
                              {byBank && ` · ${ACCOUNT_CLASS_LABELS[accountClass(a.type)]}`}
                              {a.id === data.settings.spendingAccountId && " · compte de dépenses"}
                              {planned !== 0 && ` · ${formatCents(planned, { signed: true })} prévus`}
                            </span>
                          </span>
                          <Amount cents={balances.get(a.id) ?? 0} className={(balances.get(a.id) ?? 0) < 0 ? "neg" : ""} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}

      {archived.length > 0 && (
        <details className="disclosure card">
          <summary>Comptes archivés ({archived.length})</summary>
          <ul className="list">
            {archived.map((a) => (
              <li key={a.id}>
                <Link href={`/comptes/${a.id}`} className="list-link">
                  <span className="list-main">
                    <span>{a.name}</span>
                    <span className="faint tiny">
                      {ACCOUNT_TYPE_LABELS[a.type]} · archivé le {formatDate(a.archivedAt!.slice(0, 10))}
                    </span>
                  </span>
                  <Amount cents={balances.get(a.id) ?? 0} />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
