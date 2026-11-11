import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { readSession } from "@/lib/auth/cookie";
import { neonExecutor } from "@/lib/db/neon";
import { userDb } from "@/lib/db/user-db";

/**
 * Couche d'accès : vérifie l'utilisateur (cookie de session signé) avant
 * toute lecture ou écriture, puis fournit un accès aux données qui s'exécute
 * sous son identité (RLS). Mise en cache pour la durée d'une requête.
 */
export const getSession = cache(async () => {
  // Données personnelles et « aujourd'hui » : toujours calculés à la requête,
  // jamais prérendus (sinon Next.js signale l'usage de l'heure courante).
  await connection();
  const session = await readSession();
  if (!session) redirect("/connexion");
  return { db: userDb(neonExecutor, session.sub), userId: session.sub, email: session.email };
});
