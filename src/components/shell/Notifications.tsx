"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Notice } from "@/components/ui/primitives";
import type { DashboardAlert } from "@/lib/domain/dashboard";

/*
 * Notifications : les alertes (découvert prévu, salaire à confirmer, bon
 * d'achat qui expire…) ne chargent plus le tableau de bord. Chaque onglet du
 * menu affiche une pastille avec le nombre d'alertes qui le concernent, et
 * leur détail apparaît en haut de l'onglet. Une alerte appartient à l'onglet
 * de son lien (ex. /operations/123 → Opérations).
 */

let current: DashboardAlert[] = [];
const EMPTY: DashboardAlert[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAlerts(): DashboardAlert[] {
  return useSyncExternalStore(subscribe, () => current, () => EMPTY);
}

/** Publie les alertes calculées côté serveur (rendu dans la mise en page). */
export function PublishAlerts({ alerts }: { alerts: DashboardAlert[] }) {
  useEffect(() => {
    current = alerts;
    listeners.forEach((l) => l());
  }, [alerts]);
  return null;
}

/** Onglet d'un lien : « /operations/123 » → « /operations ». */
export function sectionOf(href: string | undefined): string {
  const segment = (href ?? "/").split(/[?#]/)[0].split("/")[1];
  return segment ? `/${segment}` : "/";
}

/** Nombre d'alertes par onglet. */
export function useAlertCounts(): Map<string, number> {
  const alerts = useAlerts();
  const counts = new Map<string, number>();
  for (const a of alerts) {
    const s = sectionOf(a.href);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return counts;
}

/** Alertes de l'onglet ouvert, en haut de la page (jamais sur le tableau de bord). */
export function SectionAlerts() {
  const pathname = usePathname();
  const alerts = useAlerts();
  const section = sectionOf(pathname);
  if (section === "/") return null;
  const mine = alerts.filter((a) => sectionOf(a.href) === section);
  if (mine.length === 0) return null;
  return (
    <section className="stack-sm" aria-label="À faire" style={{ marginBottom: 16 }}>
      {mine.map((alert, i) => (
        <Link key={i} href={alert.href ?? section}>
          <Notice tone={alert.level === "danger" ? "danger" : alert.level === "warning" ? "warning" : "info"} title={alert.title}>
            {alert.detail}
          </Notice>
        </Link>
      ))}
    </section>
  );
}
