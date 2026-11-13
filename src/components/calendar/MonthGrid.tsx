/**
 * Grille d'un mois (lundi → dimanche) avec les opérations de chaque jour.
 * Utilisée par l'onglet Calendrier (cases cliquables vers le détail du jour)
 * et par le tableau de bord (lecture seule : ni lien ni action).
 */
import { Amount } from "@/components/ui/primitives";
import { endOfMonth, formatDate, isoWeekday, parts, startOfMonth, type IsoDate, type MonthKey } from "@/lib/dates";
import type { CalendarItem } from "@/lib/domain/calendar";
import styles from "./month-grid.module.css";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
/** Opérations affichées dans une case avant « +N ». */
const PER_CELL = 3;

export function signedAmount(item: CalendarItem): number {
  return item.kind === "expense" ? -item.amountCents : item.amountCents;
}

export function MonthGrid({
  month,
  today,
  items,
  dayHref,
}: {
  month: MonthKey;
  today: IsoDate;
  items: CalendarItem[];
  /** Lien d'une case qui a des opérations ; absent = grille en lecture seule. */
  dayHref?: (date: IsoDate) => string;
}) {
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);

  // Du lundi précédant le 1er au dimanche suivant la fin du mois.
  const lastDay = parts(endOfMonth(month)).day;
  const cells: (string | null)[] = [
    ...Array.from({ length: isoWeekday(startOfMonth(month)) - 1 }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className={styles.grid}>
      {WEEKDAYS.map((d) => (
        <div key={d} className={styles.weekday} aria-hidden>
          {d}
        </div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={`vide-${i}`} className={styles.empty} aria-hidden />;
        const list = byDate.get(date) ?? [];
        const spent = list.filter((x) => x.kind === "expense").reduce((s, x) => s + x.amountCents, 0);
        const label = list.length > 0 ? `${formatDate(date, "long")} : ${list.map((x) => x.label).join(", ")}` : undefined;
        const content = (
          <>
            <span className={styles.dayNumber}>{parts(date).day}</span>
            <ul className={styles.chips}>
              {list.slice(0, PER_CELL).map((x) => (
                <li key={x.key} className={`${styles.chip} ${styles[x.kind]} ${x.upcoming ? styles.upcoming : ""}`}>
                  <span className={styles.chipLabel}>{x.label}</span>
                  <Amount cents={signedAmount(x)} signed className={styles.chipAmount} />
                </li>
              ))}
              {list.length > PER_CELL && <li className="faint tiny">+{list.length - PER_CELL}</li>}
            </ul>
            {spent > 0 && <Amount cents={-spent} signed className={styles.mobileTotal} />}
            {spent === 0 && list.length > 0 && <span className={`${styles.mobileDot} ${styles[list[0].kind]}`} aria-hidden />}
          </>
        );
        return (
          <div key={date} className={`${styles.cell} ${date === today ? styles.today : ""}`} aria-label={dayHref ? undefined : label}>
            {list.length > 0 && dayHref ? (
              <a href={dayHref(date)} className={styles.cellLink} aria-label={label}>
                {content}
              </a>
            ) : (
              content
            )}
          </div>
        );
      })}
    </div>
  );
}
