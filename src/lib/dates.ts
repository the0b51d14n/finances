/**
 * Dates civiles (« YYYY-MM-DD ») interprétées dans le fuseau Europe/Paris.
 *
 * Les opérations financières portent sur des jours, pas sur des instants :
 * on manipule donc des chaînes ISO et l'arithmétique se fait en UTC pur
 * (Date.UTC), ce qui évite tout décalage lié à l'heure d'été. Seule la
 * détermination du « jour courant » dépend du fuseau français.
 */

export type IsoDate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

export const TIME_ZONE = "Europe/Paris";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const DAY_MS = 86_400_000;

const parisDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Jour courant à Paris (ex. 00:30 à Paris le 1er = le 1er, même si UTC est la veille). */
export function todayParis(now: Date = new Date()): IsoDate {
  return parisDateFormatter.format(now);
}

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isValidMonthKey(value: string): boolean {
  const m = MONTH_KEY.exec(value);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

function toUtcMs(iso: IsoDate): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Date invalide : ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parts(iso: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Date invalide : ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function makeDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(iso) + days * DAY_MS);
}

/** Nombre de jours de a à b (b − a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/**
 * Ajoute des mois en conservant le jour d'ancrage et en le bornant à la fin
 * du mois : 31 janvier + 1 mois = 28/29 février, + 2 mois = 31 mars.
 */
export function addMonths(iso: IsoDate, months: number, anchorDay?: number): IsoDate {
  const { year, month, day } = parts(iso);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const mo = (index % 12) + 1;
  const d = Math.min(anchorDay ?? day, daysInMonth(y, mo));
  return makeDate(y, mo, d);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(iso: IsoDate): number {
  const day = new Date(toUtcMs(iso)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Semaines du lundi au dimanche (usage français). */
export function startOfWeek(iso: IsoDate): IsoDate {
  return addDays(iso, 1 - isoWeekday(iso));
}

export function endOfWeek(iso: IsoDate): IsoDate {
  return addDays(startOfWeek(iso), 6);
}

export function monthKeyOf(iso: IsoDate): MonthKey {
  return iso.slice(0, 7);
}

export function startOfMonth(key: MonthKey): IsoDate {
  return `${key}-01`;
}

export function endOfMonth(key: MonthKey): IsoDate {
  const [y, m] = key.split("-").map(Number);
  return makeDate(y, m, daysInMonth(y, m));
}

export function addMonthsToKey(key: MonthKey, months: number): MonthKey {
  return monthKeyOf(addMonths(`${key}-01`, months));
}

/** Liste des mois de `from` à `to` inclus, dans l'ordre chronologique. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = from; k <= to; k = addMonthsToKey(k, 1)) out.push(k);
  return out;
}

/** Nombre de mois calendaires entiers de a à b (b − a), arrondi au mois inférieur. */
export function diffMonths(a: IsoDate, b: IsoDate): number {
  const pa = parts(a);
  const pb = parts(b);
  let months = (pb.year - pa.year) * 12 + (pb.month - pa.month);
  if (pb.day < pa.day && pb.day < daysInMonth(pb.year, pb.month)) months -= 1;
  return months;
}

// -----------------------------------------------------------------------------
// Affichage (les dates civiles sont formatées en UTC pour ne jamais décaler)
// -----------------------------------------------------------------------------

const dayFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const dayShortFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });
const dayLongFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const monthFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" });
const monthShortFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "short" });

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDate(iso: IsoDate, style: "short" | "medium" | "long" = "medium"): string {
  const date = new Date(toUtcMs(iso));
  if (style === "short") return dayShortFormatter.format(date);
  if (style === "long") return capitalize(dayLongFormatter.format(date));
  return dayFormatter.format(date);
}

/** « 2026-10 » → « Octobre 2026 ». */
export function formatMonth(key: MonthKey): string {
  return capitalize(monthFormatter.format(new Date(toUtcMs(`${key}-01`))));
}

export function formatMonthShort(key: MonthKey): string {
  return monthShortFormatter.format(new Date(toUtcMs(`${key}-01`))).replace(".", "");
}

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

/** Horodatage (instant) affiché à l'heure de Paris. */
export function formatDateTime(timestamp: string): string {
  return dateTimeFormatter.format(new Date(timestamp));
}
