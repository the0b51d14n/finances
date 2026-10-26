"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { signOutAction } from "@/app/actions/auth";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./shell.module.css";

type NavItem = { href: string; label: string; icon: IconName };

const SECTIONS: NavItem[] = [
  { href: "/", label: "Tableau de bord", icon: "home" },
  { href: "/comptes", label: "Comptes", icon: "wallet" },
  { href: "/operations", label: "Opérations", icon: "list" },
  { href: "/budget", label: "Budget", icon: "pie" },
  { href: "/calendrier", label: "Calendrier", icon: "calendar" },
  { href: "/analyses", label: "Analyses mensuelles", icon: "chart" },
  { href: "/objectifs", label: "Épargne et objectifs", icon: "target" },
  { href: "/ressources", label: "Ressources et avantages", icon: "gift" },
  { href: "/previsions", label: "Prévisions et simulateur", icon: "trend" },
  { href: "/achats", label: "Achats planifiés", icon: "cart" },
  { href: "/parametres", label: "Paramètres", icon: "settings" },
];

const MOBILE_PRIMARY: NavItem[] = [
  { href: "/", label: "Accueil", icon: "home" },
  { href: "/operations", label: "Opérations", icon: "list" },
  { href: "/previsions", label: "Prévisions", icon: "trend" },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const quickAdd = `/operations/nouvelle?retour=${encodeURIComponent(pathname)}`;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

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
        <Link href={quickAdd} className={`btn btn-primary btn-block ${styles.quickAdd}`}>
          <Icon name="plus" size={16} /> Ajouter une opération
        </Link>
        <nav className={styles.navList}>
          {SECTIONS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.navItem}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
            >
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

      {/* Mobile : barre basse avec ajout rapide central */}
      <nav className={styles.bottomNav} aria-label="Navigation principale">
        {MOBILE_PRIMARY.slice(0, 2).map((item) => (
          <Link key={item.href} href={item.href} className={styles.bottomItem} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </Link>
        ))}
        <Link href={quickAdd} className={styles.fab} aria-label="Ajouter une opération">
          <Icon name="plus" size={26} />
        </Link>
        {MOBILE_PRIMARY.slice(2).map((item) => (
          <Link key={item.href} href={item.href} className={styles.bottomItem} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </Link>
        ))}
        <button type="button" className={styles.bottomItem} onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="menu-mobile">
          <Icon name="menu" size={22} />
          <span>Menu</span>
        </button>
      </nav>

      {menuOpen && (
        <div className={styles.sheetBackdrop} onClick={() => setMenuOpen(false)}>
          <div id="menu-mobile" className={styles.sheet} role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <strong>Menu</strong>
              <button type="button" className="btn btn-ghost" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu">
                <Icon name="x" />
              </button>
            </div>
            <nav className={styles.navList}>
              {SECTIONS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.navItem}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              ))}
            </nav>
            <form action={signOutAction} style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-ghost btn-block" style={{ justifyContent: "flex-start" }}>
                <Icon name="logout" /> Se déconnecter
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
