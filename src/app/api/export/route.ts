import { buildBackup, buildOperationsCsv } from "@/lib/backup";
import { loadFinanceData } from "@/lib/data/load";

/**
 * Export des données de l'utilisateur connecté (lecture sous RLS).
 *  - format=json : sauvegarde complète, montants en centimes entiers, réimportable ;
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
    return new Response(JSON.stringify(buildBackup(data, new Date().toISOString()), null, 2), {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="finances-${stamp}.json"`,
      },
    });
  }

  return new Response(buildOperationsCsv(data), {
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="operations-${stamp}.csv"`,
    },
  });
}
