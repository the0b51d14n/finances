/**
 * Jeton de session : charge utile JSON signée par HMAC-SHA256 (Web Crypto).
 * Format : <charge utile base64url>.<signature base64url>.
 * Utilisé par le proxy (vérification à chaque navigation, sans base de
 * données) et par la couche d'accès aux données.
 */

export const SESSION_COOKIE = "finances_session";
/** Durée de validité d'une session : 30 jours. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type SessionPayload = { sub: string; email: string; exp: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function importKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(user: { id: string; email: string }, secret: string, nowMs = Date.now()): Promise<string> {
  const payload: SessionPayload = { sub: user.id, email: user.email, exp: Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret), encoder.encode(body));
  return `${body}.${Buffer.from(signature).toString("base64url")}`;
}

/** Charge utile si le jeton est authentique et non expiré, sinon null. */
export async function verifySession(token: string | undefined, secret: string, nowMs = Date.now()): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  // Vérification en temps constant par Web Crypto.
  const valid = await crypto.subtle.verify("HMAC", await importKey(secret), Buffer.from(signature, "base64url"), encoder.encode(body));
  if (!valid) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof p.sub !== "string" || !UUID.test(p.sub) || typeof p.email !== "string" || typeof p.exp !== "number") return null;
    if (p.exp * 1000 <= nowMs) return null;
    return { sub: p.sub, email: p.email, exp: p.exp };
  } catch {
    return null;
  }
}
