import { loadFinanceData } from "@/lib/data/load";
import { centsToInput } from "@/lib/money";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/view/labels";

/**
 * Export des données de l'utilisateur connecté (lecture sous RLS).
 *  - format=json : sauvegarde complète, montants en centimes entiers ;
 *  - format=csv  : opérations, séparateur « ; » et virgule décimale (Excel FR).
 */
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const data = await loadFinanceData();
  const stamp = data.today;
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (format === "json") {
    const body = JSON.stringify(
      {
        format: "finances-perso",
        version: 1,
        exportedAt: new Date().toISOString(),
        currency: "EUR",
        amountsUnit: "centimes",
        settings: data.settings,
        accounts: data.accounts,
        categories: data.categories,
        transactions: data.transactions,
        recurringRules: data.rules,
        budgets: data.budgets,
        savingsGoals: data.goals,
        goalAllocations: data.allocations,
        purchasePlans: data.purchasePlans,
      },
      null,
      2,
    );
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="finances-${stamp}.json"`,
      },
    });
  }

  const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
  const categories = new Map(data.categories.map((c) => [c.id, c.name]));
  const cell = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    ["Date", "Libellé", "Type", "Statut", "Montant", "Catégorie", "Écritures", "Exceptionnelle", "Notes", "Identifiant"].join(";"),
    ...[...data.transactions].reverse().map((t) =>
      [
        t.date,
        t.label,
        KIND_LABELS[t.kind],
        STATUS_LABELS[t.status],
        centsToInput(t.kind === "expense" ? -t.amountCents : t.amountCents),
        t.categoryId ? (categories.get(t.categoryId) ?? "") : "",
        t.entries.map((e) => `${accounts.get(e.accountId) ?? "?"} ${centsToInput(e.amountCents)}`).join(" | "),
        t.isExceptional ? "oui" : "",
        t.notes ?? "",
        t.id,
      ]
        .map((v) => cell(String(v)))
        .join(";"),
    ),
  ];
  // BOM UTF-8 pour un affichage correct des accents dans Excel.
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="operations-${stamp}.csv"`,
    },
  });
}
