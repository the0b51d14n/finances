/**
 * Montants : toujours manipulés en centimes entiers (number entier sûr).
 * Aucune arithmétique flottante n'est faite sur les montants ; la seule
 * division par 100 a lieu à l'affichage.
 */

export type Cents = number;

const MAX_CENTS = 100_000_000_000; // 1 milliard d'euros : borne de cohérence.

const SPACES = /[\s  ]/g;

/**
 * Convertit une saisie utilisateur (« 12 », « 12,5 », « 1 234,56 »,
 * « 1.234,56 », « 12.50 € ») en centimes. Renvoie null si la saisie est
 * invalide (plus de deux décimales, caractères parasites, valeur hors bornes).
 * Le signe n'est pas accepté : le type de mouvement porte le sens.
 */
export function parseAmountToCents(input: string): Cents | null {
  let s = input.replace(SPACES, "").replace(/€$/, "").replace(/^€/, "");
  if (s === "") return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Le dernier séparateur est décimal, l'autre sert de séparateur de milliers.
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    const intPart = s.slice(0, s.lastIndexOf(decimal));
    const decPart = s.slice(s.lastIndexOf(decimal) + 1);
    if (!/^\d{1,3}([.,]\d{3})*$/.test(intPart) || intPart.includes(decimal)) return null;
    s = intPart.split(thousands).join("") + "." + decPart;
  } else {
    s = s.replace(",", ".");
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return null;
  const units = match[1].replace(/^0+(?=\d)/, "");
  const decimals = (match[2] ?? "").padEnd(2, "0");
  if (units.length > 12) return null;
  const cents = Number(units) * 100 + Number(decimals);
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/** Représentation éditable d'un montant : 123456 → « 1234,56 ». */
export function centsToInput(cents: Cents): string {
  const abs = Math.abs(cents);
  const units = Math.trunc(abs / 100);
  const rest = abs % 100;
  return `${cents < 0 ? "-" : ""}${units},${String(rest).padStart(2, "0")}`;
}

const formatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Affichage français : 123456 → « 1 234,56 € ». */
export function formatCents(cents: Cents, options: { signed?: boolean; compact?: boolean } = {}): string {
  const f = options.compact ? compactFormatter : formatter;
  const text = f.format(cents / 100);
  if (options.signed && cents > 0) return `+${text}`;
  return text;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Pourcentage arrondi à une décimale, ou null si la base est nulle. */
export function percentage(part: Cents, whole: Cents): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function formatPct(value: number | null, options: { signed?: boolean } = {}): string {
  if (value === null) return "—";
  const text = `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  return options.signed && value > 0 ? `+${text}` : text;
}
