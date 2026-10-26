import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { archiveAccountAction, deleteAccountAction } from "@/app/actions/ledger";
import { AccountForm, AdjustBalanceForm } from "@/components/forms/AccountForms";
import { TransactionList } from "@/components/ledger/TransactionList";
import { ActionButton } from "@/components/ui/forms";
import { Icon } from "@/components/ui/Icon";
import { Badge, Notice, PageHeader, PageSkeleton, StatTile } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { accountKindLabel, accountSubtype } from "@/lib/domain/account-kinds";
import { ACCOUNT_CLASS_LABELS, accountClass, balancesAt, countsInBalance } from "@/lib/domain/accounts";
import { centsToInput, formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "Compte" };

export default function AccountPage(props: PageProps<"/comptes/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountDetail params={props.params} />
    </Suspense>
  );
}

async function AccountDetail({ params }: { params: PageProps<"/comptes/[id]">["params"] }) {
  const { id } = await params;
  const data = await loadFinanceData();
  const account = data.accounts.find((a) => a.id === id);
  if (!account) notFound();

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const balance = balancesAt(data.accounts, data.transactions, data.today).get(account.id) ?? account.openingBalanceCents;
  const related = data.transactions.filter((tx) => tx.entries.some((e) => e.accountId === account.id));
  const planned = related.filter((tx) => tx.status === "planned");
  const history = related.filter((tx) => tx.status !== "planned");
  const beforeOpening = related.filter((tx) => tx.status === "confirmed" && tx.date < account.openingBalanceDate);

  // Solde après chaque opération comptabilisée (ordre chronologique).
  const running = new Map<string, number>();
  let acc = account.openingBalanceCents;
  for (const tx of [...history].reverse()) {
    if (!countsInBalance(account, tx)) continue;
    acc += tx.entries.find((e) => e.accountId === account.id)?.amountCents ?? 0;
    running.set(tx.id, acc);
  }

  const credits = history.filter((tx) => tx.status === "confirmed").reduce((s, tx) => s + Math.max(0, tx.entries.find((e) => e.accountId === account.id)!.amountCents), 0);
  const debits = history.filter((tx) => tx.status === "confirmed").reduce((s, tx) => s + Math.min(0, tx.entries.find((e) => e.accountId === account.id)!.amountCents), 0);
  const isVoucher = account.type === "meal_voucher";

  return (
    <div className="stack">
      <PageHeader
        title={account.name}
        subtitle={`${account.institution ? `${account.institution} · ` : ""}${accountKindLabel(account)} · ${ACCOUNT_CLASS_LABELS[accountClass(account.type)]}`}
        back={{ href: "/comptes", label: "Comptes" }}
        actions={
          !account.archivedAt && (
            <Link href={`/operations/nouvelle?compte=${account.id}&retour=/comptes/${account.id}`} className="btn btn-primary">
              <Icon name="plus" size={16} /> Opération
            </Link>
          )
        }
      />

      {account.archivedAt && (
        <Notice tone="info" title="Compte archivé">
          Archivé le {formatDate(account.archivedAt.slice(0, 10))}. Son historique est conservé et reste pris en compte dans les analyses passées.
        </Notice>
      )}
      {beforeOpening.length > 0 && (
        <Notice tone="warning" title={`${beforeOpening.length} opération(s) antérieure(s) au solde initial`}>
          Elles sont datées avant le {formatDate(account.openingBalanceDate)} et n&apos;affectent donc pas le solde (réputées déjà incluses dans le solde
          initial). Elles restent comptées dans les analyses mensuelles.
        </Notice>
      )}

      <section className="grid-stats">
        <StatTile label="Solde actuel" cents={balance} nature="actual" emphasis tone="auto" />
        <StatTile label="Solde initial" cents={account.openingBalanceCents} hint={`au début du ${formatDate(account.openingBalanceDate)}`} />
        <StatTile label={isVoucher ? "Crédits reçus" : "Entrées confirmées"} cents={credits} />
        <StatTile label={isVoucher ? "Dépenses en tickets" : "Sorties confirmées"} cents={-debits} />
      </section>
      {isVoucher && account.validUntil && (
        <p className="muted small">
          Validité indiquée : jusqu&apos;au {formatDate(account.validUntil)}.
        </p>
      )}

      {planned.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Opérations prévues</h2>
            <Badge tone="forecast">Non comptées dans le solde</Badge>
          </div>
          <TransactionList transactions={planned} accountsById={accountsById} categoriesById={categoriesById} accountId={account.id} />
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Historique des mouvements</h2>
          <Link href={`/operations?compte=${account.id}`} className="link small">
            Filtrer dans Opérations
          </Link>
        </div>
        <TransactionList
          transactions={history.slice(0, 150)}
          accountsById={accountsById}
          categoriesById={categoriesById}
          accountId={account.id}
          runningBalances={running}
          emptyText="Aucun mouvement enregistré sur ce compte."
        />
        {history.length > 150 && <p className="faint small">Seuls les 150 mouvements les plus récents sont affichés ici.</p>}
      </section>

      {!account.archivedAt && (
        <section className="card">
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

      <details className="disclosure card">
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
        <ActionButton action={archiveAccountAction} fields={{ id: account.id, archive: account.archivedAt ? "0" : "1" }} className="btn">
          <Icon name="archive" size={16} /> {account.archivedAt ? "Réactiver le compte" : "Archiver le compte"}
        </ActionButton>
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
          Un compte utilisé ne peut pas être supprimé (historique à préserver) : archivez-le. Solde actuel : {formatCents(balance)}.
        </p>
      )}
    </div>
  );
}
