import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { toAccountOptions, toCategoryOptions } from "@/components/forms/options";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { safeReturnTo } from "@/lib/actions/state";
import { addDays } from "@/lib/dates";
import { loadFinanceData } from "@/lib/data/load";
import { entriesToInput, frequentOperations, type FrequentOperation } from "@/lib/domain/ledger";
import type { TransactionKind } from "@/lib/domain/types";
import { centsToInput, formatCents, parseAmountToCents } from "@/lib/money";

export const metadata: Metadata = { title: "Nouvelle opération" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function NewOperationPage(props: PageProps<"/operations/nouvelle">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={0} />}>
      <NewOperation searchParams={props.searchParams} />
    </Suspense>
  );
}

async function NewOperation({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const data = await loadFinanceData();
  const returnTo = safeReturnTo(one(params.retour), "/operations");
  const active = data.accounts.filter((a) => !a.archivedAt);

  if (active.length === 0) {
    return (
      <>
        <PageHeader title="Nouvelle opération" back={{ href: returnTo, label: "Retour" }} />
        <div className="card">
          <EmptyState icon="wallet" title="Créez d'abord un compte" action={<Link href="/comptes/nouveau" className="btn btn-primary">Créer un compte</Link>}>
            Une opération est toujours rattachée à un compte.
          </EmptyState>
        </div>
      </>
    );
  }

  // Pré-remplissage : depuis un achat planifié (?achat=), une opération à dupliquer
  // (?dupliquer=), un virement conseillé (?type=transfer&compte=&vers=&montant=) ou un modèle rapide.
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const plan = data.purchasePlans.find((p) => p.id === one(params.achat) && p.status === "active");
  const source = plan ? undefined : data.transactions.find((t) => t.id === one(params.dupliquer));
  const copy = source ? entriesToInput(source, accountsById) : null;
  const requestedKind = plan ? "expense" : (copy?.kind ?? one(params.type));
  const kind: TransactionKind = ["expense", "income", "transfer", "adjustment"].includes(requestedKind) ? (requestedKind as TransactionKind) : "expense";
  const spending = active.find((a) => a.id === data.settings.spendingAccountId);
  const copiedAccount = copy ? (copy.kind === "transfer" ? copy.fromAccountId : copy.accountId) : "";
  const requestedAccount = active.find((a) => a.id === (plan?.accountId ?? (copiedAccount || one(params.compte))));
  const defaultAccount = requestedAccount ?? (kind === "expense" ? spending : undefined) ?? active.find((a) => a.type === "checking") ?? active[0];
  const amountCents = plan ? plan.priceCents : (source?.amountCents ?? parseAmountToCents(one(params.montant)));
  const requestedCategory = source?.categoryId ?? one(params.categorie);
  const categoryId = plan?.categoryId ?? (data.categories.some((c) => c.id === requestedCategory) ? requestedCategory : "");
  const requestedTo = copy?.kind === "transfer" ? copy.toAccountId : one(params.vers);
  const toAccountId = active.some((a) => a.id === requestedTo) ? requestedTo : "";
  const prefilled = !!(plan || source || one(params.libelle) || one(params.montant));
  const templates = prefilled ? [] : frequentOperations(data.transactions, addDays(data.today, -120));
  const templateHref = (op: FrequentOperation) => {
    const sp = new URLSearchParams({ type: op.kind, libelle: op.label, montant: centsToInput(op.amountCents), compte: op.accountId, retour: returnTo });
    if (op.categoryId) sp.set("categorie", op.categoryId);
    if (op.toAccountId) sp.set("vers", op.toAccountId);
    return `/operations/nouvelle?${sp.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={plan ? `Achat : ${plan.name}` : source ? "Dupliquer une opération" : "Nouvelle opération"}
        subtitle={
          plan
            ? "Ajustez le montant réel : l'achat sera retiré de votre liste une fois la dépense confirmée."
            : source
              ? `Copie de « ${source.label} » datée d'aujourd'hui : vérifiez la date et le montant.`
              : undefined
        }
        back={{ href: returnTo, label: "Retour" }}
      />
      {templates.length > 0 && (
        <nav className="row" aria-label="Saisie rapide" style={{ maxWidth: 760, flexWrap: "wrap" }}>
          <span className="faint small">Saisie rapide :</span>
          {templates.map((op) => (
            <Link key={`${op.kind}-${op.label}-${op.accountId}`} href={templateHref(op)} className="btn btn-sm">
              {op.label} · {formatCents(op.amountCents)}
            </Link>
          ))}
        </nav>
      )}
      <div className="card" style={{ maxWidth: 760 }}>
        <TransactionForm
          accounts={toAccountOptions(data.accounts)}
          categories={toCategoryOptions(data.categories)}
          today={data.today}
          returnTo={returnTo}
          initial={{
            kind,
            status: "confirmed",
            date: data.today,
            label: plan?.name ?? source?.label ?? one(params.libelle).slice(0, 140),
            amount: amountCents ? centsToInput(amountCents) : "",
            accountId: defaultAccount.id,
            toAccountId,
            categoryId,
            voucherAccountId: copy?.kind === "expense" ? (copy.voucherAccountId ?? "") : "",
            voucherAmount: copy?.kind === "expense" && copy.voucherCents ? centsToInput(copy.voucherCents) : "",
            direction: copy?.kind === "adjustment" ? copy.direction : "increase",
            notes: source?.notes ?? "",
            isExceptional: source?.isExceptional ?? false,
            purchasePlanId: plan?.id ?? null,
          }}
        />
      </div>
    </>
  );
}
