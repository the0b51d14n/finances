/**
 * Barres horizontales d'une seule série (répartition par catégorie).
 * Chaque barre porte son libellé et sa valeur en texte (identité jamais
 * portée par la couleur seule) ; une seule teinte, longueur = montant.
 */
import Link from "next/link";
import { formatCents, type Cents } from "@/lib/money";
import styles from "./charts.module.css";

export type BarRow = { key: string; label: string; cents: Cents; detail?: string; href?: string };

export function BarList({ rows, total, ariaLabel }: { rows: BarRow[]; total?: Cents; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const sum = total ?? rows.reduce((s, r) => s + r.cents, 0);
  return (
    <ul className={styles.barList} aria-label={ariaLabel}>
      {rows.map((row) => {
        const pct = sum > 0 ? Math.round((row.cents / sum) * 100) : 0;
        const content = (
          <>
            <div className={styles.barHead}>
              <span className={styles.barLabel}>{row.label}</span>
              <span className="num small">
                {formatCents(row.cents)} <span className="faint">· {pct} %</span>
              </span>
            </div>
            <div className={styles.barTrack} title={`${row.label} : ${formatCents(row.cents)} (${pct} %)`}>
              <span className={styles.barFill} style={{ width: `${Math.max(1.5, (row.cents / max) * 100)}%` }} />
            </div>
            {row.detail && <span className="faint tiny">{row.detail}</span>}
          </>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} className={styles.barLink}>
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}
