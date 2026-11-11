import { describe, expect, it } from "vitest";
import { deleteById, ident, insertInto, raw, sql, updateWhere } from "@/lib/db/sql";

describe("constructeur SQL paramétré", () => {
  it("transforme chaque valeur en paramètre, jamais en texte", () => {
    const evil = "x'; drop table public.accounts; --";
    const q = sql`select * from public.accounts where name = ${evil} and id = ${"abc"}`;
    expect(q.text).toBe("select * from public.accounts where name = $1 and id = $2");
    expect(q.values).toEqual([evil, "abc"]);
  });

  it("renumérote les paramètres des sous-requêtes", () => {
    const inner = sql`select id from public.accounts where name = ${"a"} or name = ${"b"}`;
    const q = sql`select ${1} as one, x.* from (${inner}) x where x.id <> ${"c"}`;
    expect(q.text).toBe("select $1 as one, x.* from (select id from public.accounts where name = $2 or name = $3) x where x.id <> $4");
    expect(q.values).toEqual([1, "a", "b", "c"]);
  });

  it("insère tels quels uniquement les fragments raw() du code", () => {
    expect(sql`select ${raw("id, name")} from t`.text).toBe("select id, name from t");
  });

  it("sérialise objets et tableaux en JSON, undefined en null", () => {
    const q = sql`select ${{ a: 1 }}::jsonb, ${[1, 2]}::jsonb, ${undefined}`;
    expect(q.values).toEqual(['{"a":1}', "[1,2]", null]);
  });

  it("refuse un identifiant non conforme", () => {
    expect(() => ident('name"; drop table x; --')).toThrow();
    expect(() => insertInto("accounts", { "bad column": 1 })).toThrow();
  });

  it("construit insert / update / delete en ignorant les valeurs undefined", () => {
    const ins = insertInto("accounts", { name: "Courant", notes: undefined, institution: null }, "id");
    expect(ins.text).toBe('insert into public."accounts" ("name", "institution") values ($1, $2) returning id');
    expect(ins.values).toEqual(["Courant", null]);

    const upd = updateWhere("budgets", { amount_cents: 500, is_active: true }, "id", "b1");
    expect(upd.text).toBe('update public."budgets" set "amount_cents" = $1, "is_active" = $2 where "id" = $3');
    expect(upd.values).toEqual([500, true, "b1"]);

    expect(deleteById("budgets", "b1")).toEqual({ text: 'delete from public."budgets" where id = $1', values: ["b1"] });
  });
});
