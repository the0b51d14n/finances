import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { toAccountOptions, toCategoryOptions } from "@/components/forms/options";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { safeReturnTo } from "@/lib/actions/state";
import { loadFinanceData } from "@/lib/data/load";
import type { TransactionKind } from "@/lib/domain/types";
import { centsToInput, parseAmountToCents } from "@/lib/money";

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

  // Pré-remplissage : depuis un achat planifié (?achat=), un virement conseillé
  // (?type=transfer&compte=&vers=&montant=) ou un lien rapide.
  const plan = data.purchasePlans.find((p) => p.id === one(params.achat) && p.status === "active");
  const requestedKind = plan ? "expense" : one(params.type);
  const kind: TransactionKind = ["expense", "income", "transfer", "adjustment"].includes(requestedKind) ? (requestedKind as TransactionKind) : "expense";
  const spending = active.find((a) => a.id === data.settings.spendingAccountId);
  const requestedAccount = active.find((a) => a.id === (plan?.accountId ?? one(params.compte)));
  const defaultAccount = requestedAccount ?? (kind === "expense" ? spending : undefined) ?? active.find((a) => a.type === "checking") ?? active[0];
  const amountCents = plan ? plan.priceCents : parseAmountToCents(one(params.montant));
  const categoryId = plan?.categoryId ?? (data.categories.some((c) => c.id === one(params.categorie)) ? one(params.categorie) : "");
  const toAccountId = active.some((a) => a.id === one(params.vers)) ? one(params.vers) : "";

  return (
    <>
      <PageHeader
        title={plan ? `Achat : ${plan.name}` : "Nouvelle opération"}
        subtitle={plan ? "Ajustez le montant réel : l'achat sera retiré de votre liste une fois la dépense confirmée." : undefined}
        back={{ href: returnTo, label: "Retour" }}
      />
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
            label: plan?.name ?? one(params.libelle).slice(0, 140),
            amount: amountCents ? centsToInput(amountCents) : "",
            accountId: defaultAccount.id,
            toAccountId,
            categoryId,
            voucherAccountId: "",
            voucherAmount: "",
            direction: "increase",
            notes: "",
            isExceptional: false,
            purchasePlanId: plan?.id ?? null,
          }}
        />
      </div>
    </>
  );
}
