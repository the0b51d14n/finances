import type { Metadata } from "next";
import { Suspense } from "react";
import { signOutAction } from "@/app/actions/auth";
import { archiveCategoryAction, deleteCategoryAction } from "@/app/actions/settings";
import { CategoryForm, DeleteDataForm, RestoreBackupForm, SettingsForm } from "@/components/forms/SettingsForms";
import { toAccountOptions } from "@/components/forms/options";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Badge, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { loadFinanceData } from "@/lib/data/load";
import type { Category } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Paramètres" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton blocks={2} />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const data = await loadFinanceData();
  const used = new Set<string>();
  for (const t of data.transactions) if (t.categoryId) used.add(t.categoryId);
  for (const r of data.rules) if (r.categoryId) used.add(r.categoryId);
  for (const b of data.budgets) used.add(b.categoryId);
  const isEmpty = [data.accounts, data.transactions, data.rules, data.budgets, data.goals, data.purchasePlans].every((list) => list.length === 0);

  const categoryList = (kind: "expense" | "income") => (
    <ul className="list">
      {data.categories
        .filter((c) => c.kind === kind)
        .map((c: Category) => (
          <li key={c.id} style={{ flexWrap: "wrap" }}>
            <details className="disclosure" style={{ flex: "1 1 240px" }}>
              <summary>
                <span style={{ opacity: c.archivedAt ? 0.55 : 1, color: "var(--text)" }}>{c.name}</span>
                {c.archivedAt && <Badge>Archivée</Badge>}
                {c.systemKey && <span className="faint tiny">par défaut</span>}
              </summary>
              <div style={{ marginTop: 8 }}>
                <CategoryForm category={{ id: c.id, name: c.name, kind: c.kind }} />
              </div>
            </details>
            <span className="row">
              <ActionButton action={archiveCategoryAction} fields={{ id: c.id, archive: c.archivedAt ? "0" : "1" }} className="btn btn-ghost btn-sm" showMessage={false}>
                {c.archivedAt ? "Réactiver" : "Archiver"}
              </ActionButton>
              {!used.has(c.id) && (
                <ActionButton action={deleteCategoryAction} fields={{ id: c.id }} className="btn btn-ghost btn-sm" confirm={`Supprimer la catégorie « ${c.name} » ?`}>
                  <Icon name="trash" size={14} />
                </ActionButton>
              )}
            </span>
          </li>
        ))}
    </ul>
  );

  return (
    <div className="stack">
      <PageHeader title="Paramètres" subtitle={data.email ? `Connecté en tant que ${data.email}` : undefined} />

      <section className="card">
        <div className="card-header">
          <h2>Préférences</h2>
          <span className="faint small">Devise : euro (EUR)</span>
        </div>
        <SettingsForm settings={data.settings} accounts={toAccountOptions(data.accounts)} />
      </section>

      <section className="card stack">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2>Catégories</h2>
        </div>
        <p className="faint small">Une catégorie utilisée ne peut être que renommée ou archivée, pour préserver l&apos;historique.</p>
        <CategoryForm />
        <div className="grid-2">
          <div>
            <h3 className="small muted" style={{ marginBottom: 6 }}>
              Dépenses
            </h3>
            {categoryList("expense")}
          </div>
          <div>
            <h3 className="small muted" style={{ marginBottom: 6 }}>
              Revenus
            </h3>
            {categoryList("income")}
          </div>
        </div>
      </section>

      <section className="card stack-sm">
        <div className="card-header">
          <h2>Export et sauvegarde</h2>
        </div>
        <p className="small muted">
          Vos données sont stockées dans votre base Supabase et synchronisées entre vos appareils. Téléchargez régulièrement une sauvegarde complète.
        </p>
        <div className="row">
          <a href="/api/export?format=json" className="btn" download>
            <Icon name="download" size={16} /> Sauvegarde complète (JSON)
          </a>
          <a href="/api/export?format=csv" className="btn" download>
            <Icon name="download" size={16} /> Opérations (CSV, Excel)
          </a>
        </div>
        <div className="divider" />
        <RestoreBackupForm empty={isEmpty} />
      </section>

      <section className="card stack-sm">
        <div className="card-header">
          <h2>Session</h2>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="btn">
            <Icon name="logout" size={16} /> Se déconnecter
          </button>
        </form>
      </section>

      <section className="card stack-sm" style={{ borderColor: "var(--negative)" }}>
        <div className="card-header">
          <h2>Zone sensible</h2>
        </div>
        <p className="small muted">
          Supprime définitivement comptes, opérations, budgets, objectifs, catégories et paramètres. Votre identifiant de connexion est conservé. Exportez
          vos données avant.
        </p>
        <DeleteDataForm />
      </section>
    </div>
  );
}
