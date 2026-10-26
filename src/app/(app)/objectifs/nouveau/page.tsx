import type { Metadata } from "next";
import { Suspense } from "react";
import { GoalForm } from "@/components/forms/PlanningForms";
import { toAccountOptions } from "@/components/forms/options";
import { PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { loadFinanceData } from "@/lib/data/load";

export const metadata: Metadata = { title: "Nouvel objectif" };

export default function NewGoalPage() {
  return (
    <>
      <PageHeader title="Nouvel objectif d'épargne" back={{ href: "/objectifs", label: "Objectifs" }} />
      <Suspense fallback={<PageSkeleton blocks={0} />}>
        <NewGoal />
      </Suspense>
    </>
  );
}

async function NewGoal() {
  const data = await loadFinanceData();
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <GoalForm
        accounts={toAccountOptions(data.accounts)}
        initial={{ name: "", target: "", targetDate: "", monthlyContribution: "", priority: "2", tracking: "manual", accountId: "", notes: "" }}
      />
    </div>
  );
}
