import { Suspense, type ReactNode } from "react";
import { Navigation, NavigationFallback } from "./Navigation";
import { SectionAlerts } from "./Notifications";
import styles from "./shell.module.css";

/** Ossature de l'application : navigation (latérale ou basse) et contenu. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <Suspense fallback={<NavigationFallback />}>
        <Navigation />
      </Suspense>
      <main className={styles.main} id="contenu">
        <div className={styles.content}>
          <Suspense fallback={null}>
            <SectionAlerts />
          </Suspense>
          {children}
        </div>
      </main>
    </div>
  );
}
