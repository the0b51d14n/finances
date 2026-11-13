"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { signOutAction } from "@/app/actions/auth";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./shell.module.css";

type NavItem = { href: string; label: string; short: string; icon: IconName };

const SECTIONS: NavItem[] = [
  { href: "/", label: "Tableau de bord", short: "Accueil", icon: "home" },
  { href: "/comptes", label: "Comptes", short: "Comptes", icon: "wallet" },
  { href: "/calendrier", label: "Calendrier", short: "Calendrier", icon: "calendar" },
  { href: "/virements", label: "Virements", short: "Virements", icon: "swap" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Bandeau hors connexion : les données ne sont jamais stockées localement. */
function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div className={styles.offline} role="alert">
      <Icon name="wifiOff" size={16} />
      Hors connexion : les données affichées peuvent être obsolètes et aucune modification ne peut être enregistrée.
    </div>
  );
}

/** Lit l'URL courante (à placer sous <Suspense>, valeur connue seulement à la requête). */
export function Navigation() {
  return <NavigationView pathname={usePathname()} />;
}

/** Navigation sans lien actif : affichée pendant le chargement de l'URL. */
export function NavigationFallback() {
  return <NavigationView pathname="" />;
}

function NavigationView({ pathname }: { pathname: string }) {
  return (
    <>
      <OfflineBanner />

      {/* Ordinateur : barre latérale */}
      <aside className={styles.sidebar} aria-label="Navigation principale">
        <Link href="/" className={styles.brand}>
          <span className={styles.logo} aria-hidden>
            €
          </span>
          Finances
        </Link>
        <nav className={styles.navList}>
          {SECTIONS.map((item) => (
            <Link key={item.href} href={item.href} className={styles.navItem} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={signOutAction} className={styles.sidebarFooter}>
          <button type="submit" className="btn btn-ghost btn-block" style={{ justifyContent: "flex-start" }}>
            <Icon name="logout" /> Se déconnecter
          </button>
        </form>
      </aside>

      {/* Mobile : barre basse */}
      <nav className={styles.bottomNav} aria-label="Navigation principale">
        {SECTIONS.map((item) => (
          <Link key={item.href} href={item.href} className={styles.bottomItem} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
            <Icon name={item.icon} size={22} />
            <span>{item.short}</span>
          </Link>
        ))}
        <form action={signOutAction} className={styles.bottomForm}>
          <button type="submit" className={styles.bottomItem}>
            <Icon name="logout" size={22} />
            <span>Quitter</span>
          </button>
        </form>
      </nav>
    </>
  );
}
