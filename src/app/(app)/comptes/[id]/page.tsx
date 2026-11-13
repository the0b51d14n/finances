import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { archiveAccountAction, deleteAccountAction } from "@/app/actions/ledger";
import { AccountForm, AdjustBalanceForm } from "@/components/forms/AccountForms";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Notice, PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { accountKindLabel, accountSubtype } from "@/lib/domain/account-kinds";
import { ACCOUNT_CLASS_LABELS, accountClass, balancesAt, hasExpiry, isExhausted } from "@/lib/domain/accounts";
import { centsToInput } from "@/lib/money";

export const metadata: Metadata = { title: "Compte" };

export default function AccountPage(props: PageProps<"/comptes/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountDetail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function AccountDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/comptes/[id]">["params"];
  searchParams: PageProps<"/comptes/[id]">["searchParams"];
}) {
  const { id } = await params;
  const editOpen = (await searchParams).modifier === "1";
  const data = await loadFinanceData();
  const account = data.accounts.find((a) => a.id === id);
  if (!account) notFound();

  const balance = balancesAt(data.accounts, data.transactions, data.today).get(account.id) ?? account.openingBalanceCents;
  const related = data.transactions.filter((tx) => tx.entries.some((e) => e.accountId === account.id));
  const exhausted = isExhausted(account, balance);

  return (
    <div className="stack">
      <PageHeader
        title={account.name}
        subtitle={`${account.institution ? `${account.institution} · ` : ""}${accountKindLabel(account)} · ${ACCOUNT_CLASS_LABELS[accountClass(account.type)]}`}
        back={{ href: "/comptes", label: "Comptes" }}
      />

      {account.archivedAt && (
        <Notice tone="info" title={exhausted ? "Épuisé" : "Compte archivé"}>
          {exhausted
            ? `Solde à 0 € le ${formatDate(account.archivedAt.slice(0, 10))} : retiré automatiquement.`
            : `Archivé le ${formatDate(account.archivedAt.slice(0, 10))}.`}
        </Notice>
      )}
      <section className="grid-stats">
        <StatTile label="Solde actuel" cents={balance} nature="actual" emphasis tone="auto" />
      </section>
      {hasExpiry(account.type) && account.validUntil && (
        <p className={account.validUntil < data.today ? "neg small" : "muted small"}>
          {account.validUntil < data.today ? "Expiré depuis le" : "Valable jusqu'au"} {formatDate(account.validUntil)}.
        </p>
      )}

      {!account.archivedAt && (
        <section className="card" id="corriger">
          <div className="card-header">
            <h2>{account.type === "investment" ? "Mettre à jour la valeur" : "Corriger le solde"}</h2>
          </div>
          {account.type === "investment" && (
            <p className="faint small">
              La variation de valeur est enregistrée comme un ajustement : elle n&apos;est comptée ni comme un revenu ni comme une dépense.
            </p>
          )}
          <AdjustBalanceForm accountId={account.id} currentCents={balance} />
        </section>
      )}

      <details className="disclosure card" id="modifier" open={editOpen}>
        <summary>Modifier le compte</summary>
        <div style={{ marginTop: 12 }}>
          <AccountForm
            openingLocked={related.length > 0}
            initial={{
              id: account.id,
              name: account.name,
              subtype: accountSubtype(account),
              // Une dette est saisie en montant restant dû (positif).
              openingBalance: centsToInput(account.type === "debt" ? 0 - account.openingBalanceCents : account.openingBalanceCents),
              openingBalanceDate: account.openingBalanceDate,
              validUntil: account.validUntil ?? "",
              institution: account.institution ?? "",
              notes: account.notes ?? "",
            }}
            institutions={[...new Set(data.accounts.map((a) => a.institution).filter((i): i is string => !!i))]}
          />
        </div>
      </details>

      <section className="row">
        {!(account.archivedAt && exhausted) && (
          <ActionButton action={archiveAccountAction} fields={{ id: account.id, archive: account.archivedAt ? "0" : "1" }} className="btn">
            <Icon name="archive" size={16} /> {account.archivedAt ? "Réactiver le compte" : "Archiver le compte"}
          </ActionButton>
        )}
        {related.length === 0 && (
          <ActionButton
            action={deleteAccountAction}
            fields={{ id: account.id }}
            className="btn btn-danger"
            confirm={`Supprimer définitivement le compte « ${account.name} » ?`}
          >
            <Icon name="trash" size={16} /> Supprimer
          </ActionButton>
        )}
      </section>
      {related.length > 0 && (
        <p className="faint tiny">
          Un compte qui a des mouvements ne peut pas être supprimé : archivez-le.
        </p>
      )}
    </div>
  );
}
