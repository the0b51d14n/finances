/**
 * Composants d'affichage sans état, utilisables côté serveur.
 * Les badges « Constaté / Estimé / Prévision » distinguent systématiquement
 * les montants réels des estimations et projections.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { formatCents, type Cents } from "@/lib/money";
import { Icon, type IconName } from "./Icon";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="stack-sm" style={{ marginBottom: 20 }}>
      {back && (
        <Link href={back.href} className="row muted small" style={{ gap: 4, minHeight: 32 }}>
          <Icon name="back" size={16} />
          {back.label}
        </Link>
      )}
      <div className="row-between" style={{ alignItems: "flex-end" }}>
        <div className="stack-sm" style={{ gap: 4, minWidth: 0 }}>
          <h1>{title}</h1>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </header>
  );
}

export function Amount({
  cents,
  signed = false,
  colored = false,
  compact = false,
  className = "",
}: {
  cents: Cents;
  signed?: boolean;
  colored?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const tone = colored ? (cents > 0 ? "pos" : cents < 0 ? "neg" : "") : "";
  return <span className={`amount ${tone} ${className}`}>{formatCents(cents, { signed, compact })}</span>;
}

export type Nature = "actual" | "estimate" | "forecast";

const NATURE_LABELS: Record<Nature, string> = {
  actual: "Constaté",
  estimate: "Estimé",
  forecast: "Prévision",
};

export function NatureBadge({ nature }: { nature: Nature }) {
  return <span className={`badge badge-${nature}`}>{NATURE_LABELS[nature]}</span>;
}

export function Badge({ tone = "default", children }: { tone?: "default" | "accent" | "positive" | "negative" | "estimate" | "forecast"; children: ReactNode }) {
  return <span className={`badge ${tone === "default" ? "" : `badge-${tone}`}`}>{children}</span>;
}

export function StatTile({
  label,
  cents,
  text,
  nature,
  hint,
  href,
  tone,
  emphasis = false,
}: {
  label: string;
  cents?: Cents;
  text?: string;
  nature?: Nature;
  hint?: ReactNode;
  href?: string;
  tone?: "auto" | "none";
  emphasis?: boolean;
}) {
  const body = (
    <div className="card stack-sm" style={{ gap: 6, height: "100%", borderColor: emphasis ? "var(--accent)" : undefined }}>
      <div className="row-between" style={{ gap: 6 }}>
        <span className="muted small">{label}</span>
        {nature && <NatureBadge nature={nature} />}
      </div>
      <div style={{ fontSize: "1.45rem", fontWeight: 650, letterSpacing: "-0.02em" }}>
        {cents !== undefined ? <Amount cents={cents} colored={tone === "auto"} /> : <span>{text}</span>}
      </div>
      {hint && <div className="faint small">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} style={{ display: "block" }}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: ReactNode;
}) {
  const icon: IconName = tone === "success" ? "check" : tone === "info" ? "info" : "alert";
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" || tone === "warning" ? "alert" : "status"}>
      <Icon name={icon} size={16} />
      <div className="stack-sm" style={{ gap: 2 }}>
        {title && <strong style={{ fontWeight: 600 }}>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function ProgressBar({ pct, level, label }: { pct: number; level?: "ok" | "warning" | "exceeded" | "accent"; label: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`progress ${level && level !== "accent" ? `progress-${level}` : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
    >
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export function EmptyState({ icon = "info", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong style={{ color: "var(--text)" }}>{title}</strong>
      {children && <p className="small" style={{ maxWidth: 420 }}>{children}</p>}
      {action}
    </div>
  );
}

export function PageSkeleton({ blocks = 4 }: { blocks?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Chargement">
      <div className="skeleton" style={{ height: 36, width: "40%" }} />
      <div className="grid-stats">
        {Array.from({ length: blocks }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 96 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 240 }} />
    </div>
  );
}

/** Variation affichée selon les règles de comparaison (pas de pourcentage trompeur). */
export function Variation({
  diffCents,
  pct,
  note,
  newLabel = "Nouveau",
  invert = false,
}: {
  diffCents: Cents;
  pct: number | null;
  note: "new" | "not_computable" | null;
  newLabel?: string;
  /** Pour les dépenses, une hausse est défavorable. */
  invert?: boolean;
}) {
  const good = invert ? diffCents < 0 : diffCents > 0;
  const tone = diffCents === 0 ? "muted" : good ? "pos" : "neg";
  const pctText =
    note === "new" ? newLabel : note === "not_computable" ? "Non calculable" : `${pct! > 0 ? "+" : ""}${pct!.toLocaleString("fr-FR")} %`;
  return (
    <span className={`num small ${tone}`}>
      {formatCents(diffCents, { signed: true })} · {pctText}
    </span>
  );
}
