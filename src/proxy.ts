import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";
import { getServerEnv } from "@/lib/env";

/** Routes accessibles sans être connecté. */
const PUBLIC_PREFIXES = ["/connexion"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Protège les routes privées à chaque navigation (vérification optimiste du
 * cookie signé, sans base de données ; chaque accès aux données revérifie la
 * session côté serveur et la RLS filtre en base).
 */
export async function proxy(request: NextRequest) {
  const env = getServerEnv();
  if (!env) return NextResponse.next(); // l'application affichera l'erreur de configuration

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, env.authSecret);
  const signedIn = session !== null;
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    if (path === "/connexion" && pathname !== "/") url.searchParams.set("suite", pathname + search);
    const response = NextResponse.redirect(url);
    // Cookie présent mais invalide ou expiré : on le retire.
    if (!signedIn && request.cookies.has(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE);
    return response;
  };

  if (!signedIn && !isPublic(pathname)) return redirectTo("/connexion");
  if (signedIn && pathname === "/connexion") return redirectTo("/");
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
