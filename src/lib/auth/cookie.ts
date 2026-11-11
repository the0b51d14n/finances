import "server-only";
import { cookies } from "next/headers";
import { requireServerEnv } from "@/lib/env";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession, verifySession, type SessionPayload } from "./token";

/** Ouvre une session : cookie signé, inaccessible au JavaScript du navigateur. */
export async function createSession(user: { id: string; email: string }): Promise<void> {
  const token = await signSession(user, requireServerEnv().authSecret);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Session de la requête en cours, ou null (absente, falsifiée ou expirée). */
export async function readSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token, requireServerEnv().authSecret);
}
