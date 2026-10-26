import type { Metadata } from "next";
import { Suspense } from "react";
import { RuleForm } from "@/components/forms/RuleForm";
import { toAccountOptions, toCategoryOptions } from "@/components/forms/options";
import { PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { safeReturnTo } from "@/lib/actions/state";
import { loadFinanceData } from "@/lib/data/load";

export const metadata: Metadata = { title: "Nouvelle échéance récurrente" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function NewRulePage(props: PageProps<"/calendrier/regles/nouvelle">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={0} />}>
      <NewRule searchParams={props.searchParams} />
    </Suspense>
  );
}

async function NewRule({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const data = await loadFinanceData();
  const kind = one(params.type) === "income" ? "income" : one(params.type) === "transfer" ? "transfer" : "expense";
  const returnTo = safeReturnTo(one(params.retour), "/calendrier");
  const defaultAccount = data.accounts.find((a) => !a.archivedAt && a.type === "checking") ?? data.accounts.find((a) => !a.archivedAt);
  return (
    <>
      <PageHeader title="Nouvelle échéance récurrente" back={{ href: returnTo, label: "Retour" }} />
      <div className="card" style={{ maxWidth: 760 }}>
        <RuleForm
          accounts={toAccountOptions(data.accounts)}
          categories={toCategoryOptions(data.categories)}
          returnTo={returnTo}
          initial={{
            kind,
            label: "",
            amount: "",
            accountId: defaultAccount?.id ?? "",
            toAccountId: "",
            categoryId: "",
            frequency: "monthly",
            startDate: data.today,
            endDate: "",
            trackingStart: data.today,
            certainty: "certain",
            isActive: true,
            notes: "",
          }}
        />
      </div>
    </>
  );
}
