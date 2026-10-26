import { revalidatePath } from "next/cache";
import { parseBackup } from "@/lib/backup";
import { dbErrorMessage } from "@/lib/data/errors";
import { getSession } from "@/lib/data/session";

/** Taille maximale acceptée (limite de corps des fonctions Vercel : 4,5 Mo). */
const MAX_BYTES = 4_000_000;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * Restauration d'une sauvegarde JSON dans un espace vide (voir import_backup).
 * Requête JSON du même site uniquement : un formulaire tiers ne peut pas envoyer
 * ce type de contenu sans autorisation explicite du navigateur.
 */
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Format de requête invalide." }, 415);
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return reply({ error: "Origine refusée." }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return reply({ error: "Fichier trop volumineux (4 Mo maximum)." }, 413);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return reply({ error: "Le fichier n'est pas un JSON valide." }, 400);
  }
  const parsed = parseBackup(raw);
  if (!parsed.ok) return reply({ error: parsed.error }, 422);

  const { supabase } = await getSession();
  const { error } = await supabase.rpc("import_backup", { p: parsed.payload });
  if (error) return reply({ error: dbErrorMessage(error) }, 409);
  revalidatePath("/", "layout");
  return reply({ ok: true, counts: parsed.counts });
}
