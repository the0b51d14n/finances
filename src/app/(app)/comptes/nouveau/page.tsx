import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountForm } from "@/components/forms/AccountForms";
import { PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { loadFinanceData } from "@/lib/data/load";

export const metadata: Metadata = { title: "Nouveau compte" };

export default function NewAccountPage() {
  return (
    <>
      <PageHeader title="Nouveau compte" back={{ href: "/comptes", label: "Comptes" }} />
      <Suspense fallback={<PageSkeleton blocks={0} />}>
        <NewAccount />
      </Suspense>
    </>
  );
}

async function NewAccount() {
  const data = await loadFinanceData();
  const institutions = [...new Set(data.accounts.map((a) => a.institution).filter((i): i is string => !!i))];
  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <AccountForm
        openingLocked={false}
        institutions={institutions}
        initial={{ name: "", subtype: "current", openingBalance: "0,00", openingBalanceDate: data.today, validUntil: "", institution: "", notes: "" }}
      />
    </div>
  );
}
