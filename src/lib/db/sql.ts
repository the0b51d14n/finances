/**
 * Construction de requêtes SQL paramétrées, sans ORM.
 *
 * Toute valeur interpolée devient un paramètre ($1, $2…) : aucune donnée
 * saisie n'est jamais concaténée au texte SQL. Seuls les fragments marqués
 * explicitement avec raw() (constantes du code : listes de colonnes…) et les
 * identifiants validés par ident() sont insérés tels quels.
 */

export type Query = { text: string; values: unknown[] };

class RawSql {
  constructor(readonly text: string) {}
}

/** Fragment SQL fixe, écrit dans le code (jamais une donnée utilisateur). */
export const raw = (text: string) => new RawSql(text);

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Identifiant SQL (table, colonne) issu du code, vérifié puis cité. */
export function ident(name: string): RawSql {
  if (!IDENTIFIER.test(name)) throw new Error(`Identifiant SQL invalide : ${name}`);
  return new RawSql(`"${name}"`);
}

/** Les objets et tableaux sont transmis en JSON (paramètres jsonb). */
function toParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (value !== null && typeof value === "object" && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}

/** Gabarit SQL : sql`select … where id = ${id}`. Accepte aussi des sous-requêtes. */
export function sql(strings: TemplateStringsArray, ...parts: unknown[]): Query {
  let text = strings[0];
  const values: unknown[] = [];
  parts.forEach((part, i) => {
    if (part instanceof RawSql) {
      text += part.text;
    } else if (isQuery(part)) {
      // Sous-requête : ses paramètres sont renumérotés à la suite.
      const offset = values.length;
      text += part.text.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`);
      values.push(...part.values);
    } else {
      values.push(toParam(part));
      text += `$${values.length}`;
    }
    text += strings[i + 1];
  });
  return { text, values };
}

function isQuery(v: unknown): v is Query {
  return typeof v === "object" && v !== null && typeof (v as Query).text === "string" && Array.isArray((v as Query).values);
}

/** Assemble des fragments avec un séparateur. */
export function join(fragments: Query[], separator: string): Query {
  return fragments.reduce<Query | null>((acc, f) => (acc ? sql`${acc}${raw(separator)}${f}` : f), null) ?? { text: "", values: [] };
}

type Row = Record<string, unknown>;

/** Clés définies seulement (comme PostgREST, une valeur undefined n'est pas écrite). */
const definedEntries = (row: Row) => Object.entries(row).filter(([, v]) => v !== undefined);

/** insert into public.<table> (cols…) values (…) [returning …] */
export function insertInto(table: string, row: Row, returning?: string): Query {
  const entries = definedEntries(row);
  const columns = join(
    entries.map(([k]) => sql`${ident(k)}`),
    ", ",
  );
  const values = join(
    entries.map(([, v]) => sql`${v}`),
    ", ",
  );
  const base = sql`insert into public.${ident(table)} (${columns}) values (${values})`;
  return returning ? sql`${base} returning ${raw(returning)}` : base;
}

/** update public.<table> set col = …, … where <col> = <value> */
export function updateWhere(table: string, patch: Row, column: string, value: unknown): Query {
  const sets = join(
    definedEntries(patch).map(([k, v]) => sql`${ident(k)} = ${v}`),
    ", ",
  );
  return sql`update public.${ident(table)} set ${sets} where ${ident(column)} = ${value}`;
}

/** delete from public.<table> where id = … */
export function deleteById(table: string, id: unknown): Query {
  return sql`delete from public.${ident(table)} where id = ${id}`;
}
