import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/ui/Icon";
import { Amount, EmptyState, PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { accountKindLabel } from "@/lib/domain/account-kinds";
import { ACCOUNT_CLASS_LABELS, accountClass, balancesAt, totalsByClass } from "@/lib/domain/accounts";
import type { Account, AccountClass } from "@/lib/domain/types";
import { formatCents } from "@/lib/money";
import styles from "./accounts.module.css";

export const metadata: Metadata = { title: "Comptes" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function AccountsPage(props: PageProps<"/comptes">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Accounts searchParams={props.searchParams} />
    </Suspense>
  );
}

const CLASS_ORDER: AccountClass[] = ["available", "savings", "reserve", "investment", "voucher", "debt"];
/** Recherche et filtre affichés au-delà de ce nombre de comptes actifs. */
const FILTERS_FROM = 5;

async function Accounts({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
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

  const q = one(params.q).trim().toLowerCase();
  const cls = CLASS_ORDER.find((c) => c === one(params.classe)) ?? "";
  const shown = active.filter(
    (a) =>
      (!cls || accountClass(a.type) === cls) &&
      (!q || [a.name, a.institution ?? "", accountKindLabel(a)].some((s) => s.toLowerCase().includes(q))),
  );
  const filtering = !!(q || cls);

  // Regroupement par banque dès qu'une banque est renseignée, sinon par classe comptable.
  const byBank = active.some((a) => a.institution);
  const byClass = (x: Account, y: Account) => CLASS_ORDER.indexOf(accountClass(x.type)) - CLASS_ORDER.indexOf(accountClass(y.type));
  const groups = byBank
    ? [...new Set(shown.map((a) => a.institution ?? ""))]
        .sort((x, y) => (x === "" ? 1 : y === "" ? -1 : x.localeCompare(y, "fr")))
        .map((bank) => ({ key: bank || "none", title: bank || "Sans banque", list: shown.filter((a) => (a.institution ?? "") === bank).sort(byClass) }))
    : CLASS_ORDER.map((c) => ({ key: c, title: ACCOUNT_CLASS_LABELS[c], list: shown.filter((a) => accountClass(a.type) === c) }));

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
          <section className="grid-stats" aria-label="Synthèse des soldes">
            <StatTile label="Disponible" cents={totals.availableCents} nature="actual" hint="Comptes courants et espèces : dépensable tout de suite" />
            <StatTile label="Épargne" cents={totals.savingsCents} nature="actual" hint="Livrets et épargne : hors argent disponible" />
            <StatTile
              label="Total des soldes"
              cents={totals.totalCents}
              nature="actual"
              hint="Disponible + épargne + réserves + placements, hors dettes et ressources affectées"
            />
            {totals.investmentCents !== 0 && <StatTile label="Placements" cents={totals.investmentCents} nature="actual" hint="Valeur à la dernière mise à jour, comprise dans le total" />}
            {totals.voucherCents !== 0 && (
              <StatTile label="Ressources affectées" cents={totals.voucherCents} nature="actual" hint="Tickets, cartes cadeaux… : ni disponibles, ni dans le total" />
            )}
            {totals.debtCents !== 0 && (
              <StatTile label="Dettes" cents={totals.debtCents} nature="actual" hint={`Patrimoine net (total − dettes) : ${formatCents(totals.netWorthCents)}`} />
            )}
          </section>

          {active.length >= FILTERS_FROM && (
            <form method="get" className={`card ${styles.filters}`} role="search">
              <div className="field">
                <label htmlFor="q">Rechercher un compte</label>
                <input id="q" name="q" className="input" defaultValue={one(params.q)} placeholder="Nom, banque ou type" />
              </div>
              <div className="field">
                <label htmlFor="classe">Famille</label>
                <select id="classe" name="classe" className="select" defaultValue={cls}>
                  <option value="">Toutes</option>
                  {CLASS_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {ACCOUNT_CLASS_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <button type="submit" className="btn">
                  <Icon name="search" size={16} /> Filtrer
                </button>
                {filtering && (
                  <Link href="/comptes" className="btn btn-ghost">
                    Tout afficher
                  </Link>
                )}
              </div>
            </form>
          )}

          {filtering && shown.length === 0 && <p className="muted small">Aucun compte ne correspond à cette recherche.</p>}

          {groups.map(({ key, title, list }) => {
            if (list.length === 0) return null;
            const groupTotal = list.filter((a) => accountClass(a.type) !== "voucher").reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
            return (
              <section key={key} className="card">
                <div className="card-header">
                  <span className={styles.groupTitle}>
                    <h2>{title}</h2>
                    <span className="faint small">
                      {list.length} compte{list.length > 1 ? "s" : ""}
                    </span>
                  </span>
                  {byBank && <span className="num small muted">{formatCents(groupTotal)}</span>}
                </div>
                <ul className="list">
                  {list.map((a) => {
                    const planned = plannedByAccount.get(a.id) ?? 0;
                    const balance = balances.get(a.id) ?? 0;
                    return (
                      <li key={a.id} className={styles.row}>
                        <Link href={`/comptes/${a.id}`} className="list-link">
                          <span className="list-main">
                            <span style={{ fontWeight: 500 }}>{a.name}</span>
                            <span className="faint tiny">
                              {accountKindLabel(a)}
                              {byBank && ` · ${ACCOUNT_CLASS_LABELS[accountClass(a.type)]}`}
                              {a.id === data.settings.spendingAccountId && " · compte de dépenses"}
                              {planned !== 0 && ` · ${formatCents(planned, { signed: true })} prévus`}
                            </span>
                          </span>
                          <Amount cents={balance} className={balance < 0 ? "neg" : ""} />
                        </Link>
                        <details className={styles.menu}>
                          <summary aria-label={`Actions pour ${a.name}`}>⋯</summary>
                          <div className={styles.menuList}>
                            <Link href={`/operations/nouvelle?compte=${a.id}&retour=/comptes`}>Ajouter une opération</Link>
                            <Link href={`/operations?compte=${a.id}`}>Voir ses opérations</Link>
                            <Link href={`/comptes/${a.id}#corriger`}>{a.type === "investment" ? "Mettre à jour la valeur" : "Corriger le solde"}</Link>
                            <Link href={`/comptes/${a.id}?modifier=1#modifier`}>Modifier ou archiver</Link>
                          </div>
                        </details>
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
                      {accountKindLabel(a)} · archivé le {formatDate(a.archivedAt!.slice(0, 10))}
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
