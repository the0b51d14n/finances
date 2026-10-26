"use client";

/**
 * Courbe(s) d'évolution en SVG, dessinée à la largeur réelle du conteneur
 * (lisible sur iPhone comme sur ordinateur). Un seul axe des ordonnées ;
 * réticule + info-bulle au survol ou au toucher ; légende dès deux séries ;
 * vue tableau accessible.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import styles from "./charts.module.css";

export type LineSeries = {
  id: string;
  label: string;
  slot: 1 | 2;
  dashed?: boolean;
  values: (number | null)[]; // centimes
};

type Props = {
  labels: string[];
  series: LineSeries[];
  threshold?: { value: number; label: string };
  height?: number;
  ariaLabel: string;
  /** Pas d'échantillonnage de la vue tableau (1 = toutes les valeurs). */
  tableStep?: number;
};

const PAD = { top: 12, right: 12, bottom: 26, left: 56 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min -= 1000;
    max += 1000;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v));
  return ticks;
}

export function LineChart({ labels, series, threshold, height = 220, ariaLabel, tableStep = 1 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    if (threshold) values.push(threshold.value);
    values.push(0);
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const innerW = Math.max(10, width - PAD.left - PAD.right);
    const innerH = height - PAD.top - PAD.bottom;
    const n = Math.max(1, labels.length - 1);
    const x = (i: number) => PAD.left + (i / n) * innerW;
    const y = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
    return { ticks, x, y, innerW };
  }, [series, threshold, width, height, labels.length]);

  const { ticks, x, y, innerW } = geometry;
  const maxXLabels = Math.max(2, Math.floor(innerW / 70));
  const xEvery = Math.max(1, Math.ceil(labels.length / maxXLabels));

  const pathOf = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onPointer = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || labels.length === 0) return;
    const rel = (clientX - rect.left - PAD.left) / innerW;
    setHover(Math.max(0, Math.min(labels.length - 1, Math.round(rel * (labels.length - 1)))));
  };

  const tooltipLeft = hover !== null ? Math.min(Math.max(x(hover), 90), width - 90) : 0;

  return (
    <figure className={styles.figure} aria-label={ariaLabel}>
      {series.length >= 2 && (
        <div className={styles.legend}>
          {series.map((s) => (
            <span key={s.id} className={styles.legendItem}>
              <svg width="18" height="8" aria-hidden>
                <line x1="1" y1="4" x2="17" y2="4" stroke={`var(--series-${s.slot})`} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div
        ref={ref}
        className={styles.plot}
        style={{ height }}
        onPointerMove={(e) => onPointer(e.clientX)}
        onPointerDown={(e) => onPointer(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={t === 0 ? 1.5 : 1} />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className={styles.axisText}>
                  {formatCents(t, { compact: true })}
                </text>
              </g>
            ))}
            {labels.map((label, i) =>
              i % xEvery === 0 ? (
                <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className={styles.axisText}>
                  {label}
                </text>
              ) : null,
            )}
            {threshold && (
              <g>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(threshold.value)}
                  y2={y(threshold.value)}
                  stroke="var(--text-faint)"
                  strokeWidth={1}
                  strokeDasharray="5 4"
                />
                <text x={width - PAD.right} y={y(threshold.value) - 5} textAnchor="end" className={styles.axisText}>
                  {threshold.label}
                </text>
              </g>
            )}
            {series.map((s) => (
              <path
                key={s.id}
                d={pathOf(s.values)}
                fill="none"
                stroke={`var(--series-${s.slot})`}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "6 4" : undefined}
              />
            ))}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--text-faint)" strokeWidth={1} />
                {series.map((s) => {
                  const v = s.values[hover];
                  return v === null || v === undefined ? null : (
                    <circle key={s.id} cx={x(hover)} cy={y(v)} r={4.5} fill={`var(--series-${s.slot})`} stroke="var(--surface)" strokeWidth={2} />
                  );
                })}
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <div className={styles.tooltip} style={{ left: tooltipLeft }} role="status">
            <strong>{labels[hover]}</strong>
            {series.map((s) => {
              const v = s.values[hover];
              return (
                <span key={s.id} className={styles.tooltipRow}>
                  <i style={{ background: `var(--series-${s.slot})` }} aria-hidden />
                  {s.label} : <b className="num">{v === null || v === undefined ? "—" : formatCents(v)}</b>
                </span>
              );
            })}
          </div>
        )}
      </div>
      <details className="disclosure tiny">
        <summary>Voir les données en tableau</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                {series.map((s) => (
                  <th key={s.id} className="r">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) =>
                i % tableStep === 0 || i === labels.length - 1 ? (
                  <tr key={i}>
                    <td>{label}</td>
                    {series.map((s) => (
                      <td key={s.id} className="r num">
                        {s.values[i] === null || s.values[i] === undefined ? "—" : formatCents(s.values[i] as number)}
                      </td>
                    ))}
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
