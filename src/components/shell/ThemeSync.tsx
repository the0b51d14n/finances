"use client";

import { useEffect } from "react";

export type ThemePreference = "dark" | "light" | "system";

/** Applique un thème et le mémorise localement (lu avant le rendu par layout.tsx). */
export function applyTheme(theme: ThemePreference) {
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Stockage indisponible (navigation privée) : le thème s'applique pour la session.
  }
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
  document.documentElement.dataset.theme = resolved;
}

/** Aligne l'appareil sur la préférence enregistrée en base (synchronisée entre appareils). */
export function ThemeSync({ theme }: { theme: ThemePreference }) {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return null;
}
