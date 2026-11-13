import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { PublishAlerts } from "@/components/shell/Notifications";
import { ThemeSync } from "@/components/shell/ThemeSync";
import { loadFinanceData } from "@/lib/data/load";
import { computeDashboard } from "@/lib/domain/dashboard";

async function SyncedTheme() {
  const { settings } = await loadFinanceData();
  return <ThemeSync theme={settings.theme} />;
}

/** Alertes (découvert, salaire à confirmer…) : pastilles du menu et haut de chaque onglet. */
async function Alerts() {
  const data = await loadFinanceData();
  if (!data.accounts.some((a) => !a.archivedAt)) return <PublishAlerts alerts={[]} />;
  const categories = new Map(data.categories.map((c) => [c.id, c.name]));
  const { alerts } = computeDashboard({ ...data, categoryName: (id) => categories.get(id) ?? "Sans catégorie" });
  return <PublishAlerts alerts={alerts} />;
}

export default function PrivateLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      {children}
      <Suspense fallback={null}>
        <SyncedTheme />
      </Suspense>
      <Suspense fallback={null}>
        <Alerts />
      </Suspense>
    </AppShell>
  );
}
