import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ThemeSync } from "@/components/shell/ThemeSync";
import { loadFinanceData } from "@/lib/data/load";

async function SyncedTheme() {
  const { settings } = await loadFinanceData();
  return <ThemeSync theme={settings.theme} />;
}

export default function PrivateLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      {children}
      <Suspense fallback={null}>
        <SyncedTheme />
      </Suspense>
    </AppShell>
  );
}
