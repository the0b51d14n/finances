import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Couche d'accès : vérifie l'utilisateur (JWT validé par getClaims) avant
 * toute lecture ou écriture. Mise en cache pour la durée d'une requête.
 */
export const getSession = cache(async () => {
  // Données personnelles et « aujourd'hui » : toujours calculés à la requête,
  // jamais prérendus (sinon Next.js signale l'usage de l'heure courante).
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/connexion");
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { supabase, userId, email };
});
