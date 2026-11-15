/**
 * Graphique circulaire (anneau) de la répartition des dépenses par domaine.
 *
 * Lisible sans la couleur : la légende à côté donne pour chaque domaine son
 * nom, son montant exact et sa part en %. Couleurs : palette catégorielle
 * validée (contrôle daltonisme et contraste, thèmes clair et sombre), dans un
 * ordre fixe ; « Autres domaines » en gris. Survol : info-bulle par part.
 */
import { formatCents } from "@/lib/money";
import type { DomainSlice } from "@/lib/domain/calendar";
import styles from "./donut.module.css";

const SIZE = 120;
const RADIUS = 46;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Espace entre deux parts (unités du graphique), pour les distinguer sans la couleur. */
const GAP = 1.6;

const pctText = (pct: number) => `${pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;

export function DonutChart({ slices, totalCents, caption }: { slices: DomainSlice[]; totalCents: number; caption: string }) {
  const colorClass = (s: DomainSlice) => (s.slot === null ? styles.other : styles[`s${s.slot + 1}`]);
  const gap = slices.length > 1 ? GAP : 0;
  const lengthOf = (s: DomainSlice) => (s.cents / totalCents) * CIRCUMFERENCE;
  const arcs = slices.map((s, i) => ({
    slice: s,
    dash: Math.max(0.01, lengthOf(s) - gap),
    // Début de la part : somme des parts précédentes.
    offset: slices.slice(0, i).reduce((sum, p) => sum + lengthOf(p), 0),
  }));

  return (
    <div className={styles.root}>
      <figure className={styles.figure}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className={styles.svg}
          role="img"
          aria-label={`${caption} : ${slices.map((s) => `${s.label} ${formatCents(s.cents)} (${pctText(s.pct)})`).join(", ")}`}
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} className={styles.track} strokeWidth={STROKE} fill="none" />
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map(({ slice, dash, offset: start }) => (
              <circle
                key={slice.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                className={`${styles.arc} ${colorClass(slice)}`}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-start}
              >
                <title>{`${slice.label} : ${formatCents(slice.cents)} (${pctText(slice.pct)})`}</title>
              </circle>
            ))}
          </g>
        </svg>
        <figcaption className={styles.center}>
          <span className={styles.total}>{formatCents(totalCents)}</span>
          <span className="faint tiny">{caption}</span>
        </figcaption>
      </figure>

      <ul className={styles.legend}>
        {slices.map((s) => (
          <li key={s.key} className={styles.row}>
            <span className={`${styles.swatch} ${colorClass(s)}`} aria-hidden />
            <span className={styles.name}>{s.label}</span>
            <span className={`num ${styles.amount}`}>{formatCents(s.cents)}</span>
            <span className={`num faint small ${styles.pct}`}>{pctText(s.pct)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
