"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

export default function ErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  return (
    <div className="card stack" style={{ maxWidth: 560, margin: "40px auto" }} role="alert">
      <div className="row" style={{ color: "var(--warning)" }}>
        <Icon name={online ? "alert" : "wifiOff"} size={22} />
        <h1 style={{ fontSize: "1.15rem", color: "var(--text)" }}>
          {online ? "Les données n'ont pas pu être chargées" : "Vous êtes hors connexion"}
        </h1>
      </div>
      <p className="muted">
        {online
          ? "Une erreur est survenue en contactant le serveur. Aucune donnée n'a été modifiée."
          : "Les données sont conservées en ligne, sur votre compte : reconnectez-vous à Internet pour les consulter."}
      </p>
      {error.name === "ConfigurationError" && <p className="small">{error.message}</p>}
      {online && (
        <p className="faint tiny">
          Première installation ? Vérifiez les variables d&apos;environnement Supabase et l&apos;application des migrations (README).
          {error.digest ? ` Référence : ${error.digest}` : ""}
        </p>
      )}
      <div>
        <button type="button" className="btn btn-primary" onClick={() => retry()}>
          Réessayer
        </button>
      </div>
    </div>
  );
}
