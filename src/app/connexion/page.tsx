import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px 16px" }}>
      <div className="stack" style={{ width: "100%", maxWidth: 400 }}>
        <div className="stack-sm" style={{ alignItems: "center", textAlign: "center" }}>
          <span
            aria-hidden
            style={{
              display: "grid",
              placeItems: "center",
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "var(--accent)",
              color: "var(--accent-ink)",
              fontWeight: 800,
              fontSize: 22,
            }}
          >
            €
          </span>
          <h1>Finances</h1>
          <p className="muted small">Vos comptes, budgets et prévisions, au même endroit.</p>
        </div>
        <Suspense fallback={<div className="skeleton" style={{ height: 280 }} />}>
          <LoginForm />
        </Suspense>
        <p className="faint tiny" style={{ textAlign: "center" }}>
          Aucune connexion bancaire : vos identifiants bancaires ne sont jamais demandés.
        </p>
      </div>
    </main>
  );
}
