import { describe, expect, it } from "vitest";
import { buildBackup, buildOperationsCsv, parseBackup } from "@/lib/backup";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { account, category, expense, income, rule, transfer } from "./fixtures";

const chk = account("chk", "checking", 100_000, "2026-10-01");
const liv = account("liv", "savings", 50_000, "2026-10-01", { subtype: "livret_a" });
const categories = [category("cat-default", "expense", "home_furnishing"), category("cat-inc", "income")];
const salary = rule({ kind: "income", amountCents: 53_000, accountId: "chk", startDate: "2026-10-28", categoryId: "cat-inc" });
const transactions = [
  transfer("2026-10-05", 10_000, "chk", "liv"),
  expense("2026-10-04", 1_250, "chk", { label: "Courses; marché", notes: 'dit "bio"' }),
  income("2026-10-02", 53_000, "chk", { categoryId: "cat-inc", recurrenceId: salary.id, occurrenceDate: "2026-10-02" }),
];

const source = {
  settings: { ...DEFAULT_SETTINGS, spendingAccountId: "chk" },
  accounts: [chk, liv],
  categories,
  transactions,
  rules: [salary],
  budgets: [],
  goals: [],
  allocations: [],
  purchasePlans: [],
};

/** Sauvegarde telle qu'écrite dans le fichier téléchargé. */
const backupFile = () => JSON.parse(JSON.stringify(buildBackup(source, "2026-10-26T10:00:00.000Z")));

describe("sauvegarde JSON", () => {
  it("relit sa propre sauvegarde et prépare la restauration", () => {
    const parsed = parseBackup(backupFile());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.counts).toEqual({ accounts: 2, transactions: 3, rules: 1, goals: 0, purchases: 0 });
    const payload = parsed.payload as {
      accounts: { subtype: string | null; opening_balance_cents: number }[];
      transactions: { entries: { account_id: string; amount_cents: number }[]; recurrence_id: string | null }[];
      settings: { spending_account_id: string };
    };
    expect(payload.accounts[1]).toMatchObject({ subtype: "livret_a", opening_balance_cents: 50_000 });
    expect(payload.transactions[0].entries).toEqual([
      { account_id: "chk", amount_cents: -10_000 },
      { account_id: "liv", amount_cents: 10_000 },
    ]);
    expect(payload.transactions[2].recurrence_id).toBe(salary.id);
    expect(payload.settings.spending_account_id).toBe("chk");
  });

  it("refuse un fichier étranger ou une sauvegarde incohérente", () => {
    expect(parseBackup({ format: "autre", version: 1 })).toMatchObject({ ok: false });
    const orphan = backupFile();
    orphan.transactions[1].entries[0].accountId = "inconnu";
    expect(parseBackup(orphan)).toMatchObject({ ok: false, error: expect.stringContaining("introuvable") });
    const wrongKind = backupFile();
    wrongKind.transactions[2].categoryId = "cat-default"; // revenu rangé dans une catégorie de dépense
    expect(parseBackup(wrongKind).ok).toBe(false);
    const badAmount = backupFile();
    badAmount.transactions[1].amountCents = 12.5;
    expect(parseBackup(badAmount).ok).toBe(false);
  });
});

describe("export CSV", () => {
  it("produit un fichier lisible par un tableur français, du plus ancien au plus récent", () => {
    const csv = buildOperationsCsv({ accounts: [chk, liv], categories, transactions });
    expect(csv.startsWith("﻿Date;Libellé;Type;")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(4);
    // Ordre inversé de la liste (la liste de l'application est du plus récent au plus ancien).
    expect(lines[1].startsWith("2026-10-02;")).toBe(true);
    // Montant négatif à virgule décimale, libellé et note contenant « ; » ou « " » protégés.
    expect(lines[2]).toContain('"Courses; marché"');
    expect(lines[2]).toContain(";-12,50;");
    expect(lines[2]).toContain('"dit ""bio"""');
  });
});
