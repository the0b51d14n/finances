import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TransactionList } from "@/components/ledger/TransactionList";
import { Icon } from "@/components/ui/Icon";
import { PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import { isValidIsoDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/view/labels";

export const metadata: Metadata = { title: "Opérations" };

const PAGE_SIZE = 100;

type Search = Record<string, string | string[] | undefined>;

export default function OperationsPage(props: PageProps<"/operations">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <Operations searchParams={props.searchParams} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Operations({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const data = await loadFinanceData();
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));

  const q = one(params.q).trim().toLowerCase();
  const account = one(params.compte);
  const category = one(params.categorie);
  const kind = one(params.type);
  const status = one(params.statut);
  const from = isValidIsoDate(one(params.du)) ? one(params.du) : "";
  const to = isValidIsoDate(one(params.au)) ? one(params.au) : "";
  const order = one(params.tri) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(one(params.page)) || 1);

  const filtered = data.transactions.filter(
    (tx) =>
      (!q || tx.label.toLowerCase().includes(q) || (tx.notes ?? "").toLowerCase().includes(q)) &&
      (!account || tx.entries.some((e) => e.accountId === account)) &&
      (!category || tx.categoryId === category) &&
      (!kind || tx.kind === kind) &&
      (!status || tx.status === status) &&
      (!from || tx.date >= from) &&
      (!to || tx.date <= to),
  );
  if (order === "asc") filtered.reverse();
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const confirmed = filtered.filter((t) => t.status === "confirmed");
  const income = confirmed.filter((t) => t.kind === "income").reduce((s, t) => s + t.amountCents, 0);
  const expense = confirmed.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amountCents, 0);
  const hasFilters = !!(q || account || category || kind || status || from || to);

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: one(params.q), compte: account, categorie: category, type: kind, statut: status, du: from, au: to, tri: order })) {
      if (v && !(k === "tri" && v === "desc")) sp.set(k, v);
    }
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/operations?${s}` : "/operations";
  };

  return (
    <div className="stack">
      <PageHeader
        title="Opérations"
        subtitle={`${filtered.length} opération(s)${hasFilters ? " correspondant aux filtres" : ""}`}
        actions={
          <Link href="/operations/nouvelle?retour=/operations" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nouvelle opération
          </Link>
        }
      />

      <form method="get" className="card form" role="search">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="q">Recherche</label>
            <input id="q" name="q" className="input" defaultValue={one(params.q)} placeholder="Libellé ou note" />
          </div>
          <div className="field">
            <label htmlFor="compte">Compte</label>
            <select id="compte" name="compte" className="select" defaultValue={account}>
              <option value="">Tous</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="categorie">Catégorie</label>
            <select id="categorie" name="categorie" className="select" defaultValue={category}>
              <option value="">Toutes</option>
              <optgroup label="Dépenses">
                {data.categories.filter((c) => c.kind === "expense").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Revenus">
                {data.categories.filter((c) => c.kind === "income").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label htmlFor="type">Type</label>
            <select id="type" name="type" className="select" defaultValue={kind}>
              <option value="">Tous</option>
              {Object.entries(KIND_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="statut">Statut</label>
            <select id="statut" name="statut" className="select" defaultValue={status}>
              <option value="">Tous</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="du">Du</label>
            <input id="du" name="du" type="date" className="input" defaultValue={from} />
          </div>
          <div className="field">
            <label htmlFor="au">Au</label>
            <input id="au" name="au" type="date" className="input" defaultValue={to} />
          </div>
          <div className="field">
            <label htmlFor="tri">Tri</label>
            <select id="tri" name="tri" className="select" defaultValue={order}>
              <option value="desc">Plus récentes d&apos;abord</option>
              <option value="asc">Plus anciennes d&apos;abord</option>
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            <Icon name="search" size={16} /> Filtrer
          </button>
          {hasFilters && (
            <Link href="/operations" className="btn btn-ghost">
              Réinitialiser
            </Link>
          )}
        </div>
      </form>

      {hasFilters && (
        <section className="grid-stats">
          <StatTile label="Revenus confirmés (filtre)" cents={income} nature="actual" />
          <StatTile label="Dépenses confirmées (filtre)" cents={expense} nature="actual" />
          <StatTile label="Solde net (filtre)" cents={income - expense} nature="actual" tone="auto" hint="Transferts internes exclus" />
        </section>
      )}

      <section className="card">
        <TransactionList
          transactions={pageItems}
          accountsById={accountsById}
          categoriesById={categoriesById}
          emptyText={hasFilters ? "Aucune opération ne correspond à ces filtres." : "Aucune opération enregistrée pour l'instant."}
        />
        {pages > 1 && (
          <nav className="row-between" style={{ marginTop: 12 }} aria-label="Pagination">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="btn btn-sm">
                Précédentes
              </Link>
            ) : (
              <span />
            )}
            <span className="faint small">
              Page {page} / {pages}
            </span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="btn btn-sm">
                Suivantes
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
