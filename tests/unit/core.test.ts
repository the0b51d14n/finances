import { describe, expect, it } from "vitest";
import { accountTypeRules, balancesAt, depletedSingleUseAccounts, totalsByClass, typeChangeAllowed } from "@/lib/domain/accounts";
import { adjustmentFor, buildEntries } from "@/lib/domain/ledger";
import { account, byId, expense, income, transfer, tx } from "./fixtures";

const chk = account("chk", "checking", 100_000);
const liv = account("liv", "savings", 50_000);
const tr = account("tr", "meal_voucher", 0);
const accounts = [chk, liv, tr];
const accountsById = byId(accounts);

describe("écritures d'une opération", () => {
  it("répartit une dépense entre la banque et les tickets-restaurant", () => {
    const res = buildEntries({ kind: "expense", amountCents: 3_000, accountId: "chk", voucherAccountId: "tr", voucherCents: 1_000 }, accountsById);
    expect(res).toEqual({ ok: true, entries: [{ accountId: "chk", amountCents: -2_000 }, { accountId: "tr", amountCents: -1_000 }] });
  });

  it("accepte une dépense entièrement payée en tickets", () => {
    const res = buildEntries({ kind: "expense", amountCents: 3_000, accountId: "tr", voucherAccountId: "tr", voucherCents: 3_000 }, accountsById);
    expect(res).toEqual({ ok: true, entries: [{ accountId: "tr", amountCents: -3_000 }] });
  });

  it("refuse les saisies incohérentes", () => {
    expect(buildEntries({ kind: "expense", amountCents: 1_000, accountId: "chk", voucherAccountId: "tr", voucherCents: 2_000 }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "expense", amountCents: 1_000, accountId: "chk", voucherAccountId: "liv", voucherCents: 500 }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "transfer", amountCents: 1_000, fromAccountId: "chk", toAccountId: "chk" }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "transfer", amountCents: 1_000, fromAccountId: "tr", toAccountId: "chk" }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "income", amountCents: 0, accountId: "chk" }, accountsById).ok).toBe(false);
    expect(buildEntries({ kind: "income", amountCents: 1_000, accountId: "inconnu" }, accountsById).ok).toBe(false);
  });

  it("paie une dépense avec plusieurs moyens (carte cadeau, tickets, compte)", () => {
    const gift = account("gift", "earmarked", 5_000, "2026-01-01", { subtype: "gift_card" });
    const ids = byId([...accounts, gift]);
    const res = buildEntries(
      { kind: "expense", amountCents: 8_000, accountId: "chk", voucherAccountId: "tr", voucherCents: 1_000, otherPayments: [{ accountId: "gift", amountCents: 5_000 }] },
      ids,
    );
    expect(res).toEqual({
      ok: true,
      entries: [
        { accountId: "chk", amountCents: -2_000 },
        { accountId: "tr", amountCents: -1_000 },
        { accountId: "gift", amountCents: -5_000 },
      ],
    });
    // Entièrement payée par la carte cadeau : aucune écriture sur le compte principal.
    expect(buildEntries({ kind: "expense", amountCents: 5_000, accountId: "chk", otherPayments: [{ accountId: "gift", amountCents: 5_000 }] }, ids)).toEqual({
      ok: true,
      entries: [{ accountId: "gift", amountCents: -5_000 }],
    });
    // Incohérences : dépassement, doublon, compte principal répété.
    expect(buildEntries({ kind: "expense", amountCents: 1_000, accountId: "chk", otherPayments: [{ accountId: "gift", amountCents: 2_000 }] }, ids).ok).toBe(false);
    expect(buildEntries({ kind: "expense", amountCents: 9_000, accountId: "chk", otherPayments: [{ accountId: "gift", amountCents: 1 }, { accountId: "gift", amountCents: 1 }] }, ids).ok).toBe(false);
    expect(buildEntries({ kind: "expense", amountCents: 9_000, accountId: "chk", otherPayments: [{ accountId: "chk", amountCents: 1 }] }, ids).ok).toBe(false);
  });

  it("retire une carte cadeau ou un bon d'achat épuisé, jamais un moyen rechargeable", () => {
    const gift = account("gift", "earmarked", 5_000, "2026-01-01", { subtype: "gift_card" });
    const avoir = account("avoir", "earmarked", 2_000, "2026-01-01", { subtype: "store_credit" });
    const kitty = account("kitty", "other", 3_000, "2026-01-01", { subtype: "online_kitty" });
    const cash = account("cash", "cash", 1_000, "2026-01-01", { subtype: "cash" });
    const fresh = account("fresh", "earmarked", 0, "2026-01-01", { subtype: "gift_card" }); // créée à 0, jamais utilisée
    const spent = [
      expense("2026-02-01", 5_000, "gift"),
      expense("2026-02-01", 1_500, "avoir"),
      expense("2026-02-01", 3_000, "kitty"),
      expense("2026-02-01", 1_000, "cash"),
    ];
    // Carte cadeau à 0 : retirée ; avoir à 5 € : gardé ; cagnotte et espèces à 0 : gardées (rechargeables).
    expect(depletedSingleUseAccounts([gift, avoir, kitty, cash, fresh], spent, "2026-02-02")).toEqual(["gift"]);
    expect(depletedSingleUseAccounts([{ ...gift, archivedAt: "2026-02-02T00:00:00Z" }], spent, "2026-02-02")).toEqual([]);
  });

  it("produit un transfert à somme nulle et des ajustements signés", () => {
    const t = buildEntries({ kind: "transfer", amountCents: 20_000, fromAccountId: "chk", toAccountId: "liv" }, accountsById);
    expect(t.ok && t.entries.reduce((s, e) => s + e.amountCents, 0)).toBe(0);
    expect(buildEntries({ kind: "adjustment", amountCents: 500, accountId: "chk", direction: "decrease" }, accountsById)).toEqual({
      ok: true,
      entries: [{ accountId: "chk", amountCents: -500 }],
    });
    expect(adjustmentFor(1_000, 1_500)).toEqual({ direction: "increase", amountCents: 500 });
    expect(adjustmentFor(1_000, 400)).toEqual({ direction: "decrease", amountCents: 600 });
    expect(adjustmentFor(1_000, 1_000)).toBeNull();
  });
});

describe("soldes", () => {
  const transactions = [
    income("2026-02-01", 120_000, "chk"),
    expense("2026-02-03", 45_000, "chk"),
    transfer("2026-02-05", 20_000, "chk", "liv"),
    expense("2026-02-10", 5_000, "chk", { status: "planned", confirmedAt: null }),
    expense("2026-02-11", 7_000, "chk", { status: "cancelled", confirmedAt: null }),
    income("2026-02-01", 15_000, "tr"),
    tx("expense", "2026-02-06", 3_000, [["chk", -2_000], ["tr", -1_000]]),
  ];

  it("ne compte que les opérations confirmées", () => {
    const b = balancesAt(accounts, transactions, "2026-02-28");
    expect(b.get("chk")).toBe(153_000);
    expect(b.get("liv")).toBe(70_000);
    expect(b.get("tr")).toBe(14_000);
    expect(balancesAt(accounts, transactions, "2026-02-04").get("chk")).toBe(175_000);
  });

  it("exclut les tickets-restaurant du total et ne fausse pas le total avec les transferts", () => {
    const totals = totalsByClass(accounts, balancesAt(accounts, transactions, "2026-02-28"));
    expect(totals).toEqual({
      totalCents: 223_000,
      availableCents: 153_000,
      savingsCents: 70_000,
      reserveCents: 0,
      investmentCents: 0,
      debtCents: 0,
      voucherCents: 14_000,
      netWorthCents: 223_000,
    });
    // Total = soldes initiaux bancaires + revenus bancaires − part bancaire des dépenses : le transfert est neutre.
    expect(totals.totalCents).toBe(150_000 + 120_000 - 45_000 - 2_000);
  });

  it("compte les placements dans le total, les dettes à part et jamais dans le disponible", () => {
    const pea = account("pea", "investment", 300_000);
    const loan = account("loan", "debt", -500_000);
    const gift = account("gift", "earmarked", 2_000);
    const all = [chk, pea, loan, gift];
    const txs = [transfer("2026-02-05", 20_000, "chk", "loan"), tx("adjustment", "2026-02-10", 15_000, [["pea", 15_000]])];
    const totals = totalsByClass(all, balancesAt(all, txs, "2026-02-28"));
    expect(totals.availableCents).toBe(80_000);
    expect(totals.investmentCents).toBe(315_000);
    expect(totals.debtCents).toBe(-480_000);
    expect(totals.voucherCents).toBe(2_000);
    expect(totals.totalCents).toBe(80_000 + 315_000);
    expect(totals.netWorthCents).toBe(80_000 + 315_000 - 480_000);
    // Rembourser une dette ne change pas le patrimoine net : seule la revalorisation du PEA le modifie.
    const before = totalsByClass(all, balancesAt(all, [], "2026-02-28"));
    expect(totals.netWorthCents - before.netWorthCents).toBe(15_000);
  });

  it("applique à chaque type exactement les règles annoncées (disponible, épargne, total, patrimoine)", () => {
    const types = ["checking", "cash", "savings", "dedicated_savings", "other", "meal_voucher", "investment", "debt", "earmarked"] as const;
    for (const type of types) {
      const balance = type === "debt" ? -10_000 : 10_000;
      const acc = account("x", type, balance);
      const totals = totalsByClass([acc], balancesAt([acc], [], "2026-02-01"));
      const rules = accountTypeRules(type);
      expect(totals.availableCents, type).toBe(rules.inAvailable ? balance : 0);
      expect(totals.savingsCents, type).toBe(rules.inSavings ? balance : 0);
      expect(totals.totalCents, type).toBe(rules.inTotal ? balance : 0);
      expect(totals.netWorthCents, type).toBe(rules.inNetWorth ? balance : 0);
    }
    expect(accountTypeRules("debt").negativeBalance).toBe("required");
    expect(accountTypeRules("earmarked")).toMatchObject({ negativeBalance: "forbidden", transferable: false });
    expect(accountTypeRules("checking")).toMatchObject({ negativeBalance: "allowed", transferable: true });
  });

  it("interdit à un compte utilisé de changer de classe comptable", () => {
    expect(typeChangeAllowed("checking", "investment", false)).toBe(true);
    expect(typeChangeAllowed("checking", "investment", true)).toBe(false);
    expect(typeChangeAllowed("savings", "dedicated_savings", true)).toBe(true);
    expect(typeChangeAllowed("checking", "cash", true)).toBe(true);
    expect(typeChangeAllowed("meal_voucher", "earmarked", true)).toBe(false);
    expect(typeChangeAllowed("debt", "debt", true)).toBe(true);
  });

  it("refuse les transferts d'avantages affectés", () => {
    const gift = account("gift", "earmarked", 2_000);
    const loan = account("loan", "debt", -500_000);
    const m = byId([chk, gift, loan]);
    expect(buildEntries({ kind: "transfer", amountCents: 1_000, fromAccountId: "gift", toAccountId: "chk" }, m).ok).toBe(false);
    expect(buildEntries({ kind: "transfer", amountCents: 1_000, fromAccountId: "chk", toAccountId: "loan" }, m).ok).toBe(true);
  });

  it("applique la règle du solde initial (opérations antérieures sans effet)", () => {
    const recent = account("recent", "checking", 10_000, "2026-03-01");
    const txs = [expense("2026-02-15", 2_500, "recent"), expense("2026-03-01", 1_000, "recent")];
    expect(balancesAt([recent], txs, "2026-03-31").get("recent")).toBe(9_000);
    expect(balancesAt([recent], txs, "2026-02-28").has("recent")).toBe(false);
  });
});
