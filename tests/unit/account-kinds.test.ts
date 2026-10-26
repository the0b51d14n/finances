import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_KIND_GROUPS, ACCOUNT_SUBTYPE_KEYS, ACCOUNT_SUBTYPES, accountKindLabel, DEFAULT_SUBTYPE } from "@/lib/domain/account-kinds";
import { accountSchema } from "@/lib/validation/schemas";

describe("natures de comptes", () => {
  it("propose chaque nature une seule fois dans les familles", () => {
    const listed = ACCOUNT_KIND_GROUPS.flatMap((g) => g.kinds);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...ACCOUNT_SUBTYPE_KEYS].sort());
  });

  it("donne à chaque type une nature par défaut du même type", () => {
    for (const [type, subtype] of Object.entries(DEFAULT_SUBTYPE)) expect(ACCOUNT_SUBTYPES[subtype].type).toBe(type);
  });

  it("correspond exactement à la contrainte SQL accounts_subtype_check", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20261026000002_account_kinds.sql"), "utf8");
    const block = sql.slice(sql.indexOf("add constraint accounts_subtype_check"), sql.indexOf("#nature inconnue"));
    const pairs = Object.fromEntries([...block.matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(Object.fromEntries(ACCOUNT_SUBTYPE_KEYS.map((k) => [k, ACCOUNT_SUBTYPES[k].type])));
  });

  it("affiche la nature, ou celle par défaut pour un ancien compte", () => {
    expect(accountKindLabel({ type: "savings", subtype: "livret_jeune" })).toBe("Livret Jeune");
    expect(accountKindLabel({ type: "checking", subtype: null })).toBe("Compte courant");
  });
});

describe("saisie d'un compte", () => {
  const base = { name: "Compte", opening_balance_date: "2026-10-26" };

  it("enregistre une dette saisie en montant restant dû comme un solde négatif", () => {
    const parsed = accountSchema.parse({ ...base, subtype: "student_loan", opening_balance: "5 000" });
    expect(parsed.type).toBe("debt");
    expect(parsed.opening_balance).toBe(-500_000);
    expect(accountSchema.safeParse({ ...base, subtype: "student_loan", opening_balance: "-5" }).success).toBe(false);
  });

  it("déduit le type de la nature et refuse un solde négatif pour une ressource affectée", () => {
    expect(accountSchema.parse({ ...base, subtype: "livret_a", opening_balance: "100" }).type).toBe("savings");
    expect(accountSchema.safeParse({ ...base, subtype: "gift_card", opening_balance: "-1" }).success).toBe(false);
    expect(accountSchema.safeParse({ ...base, subtype: "inconnu", opening_balance: "0" }).success).toBe(false);
  });
});
