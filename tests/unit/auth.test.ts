import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "@/lib/auth/token";

const SECRET = "s".repeat(40);
const USER = { id: "0b7c1c9e-5a8e-4c43-9a4e-1f2d3c4b5a69", email: "moi@example.test" };

describe("mots de passe (scrypt)", () => {
  it("vérifie le bon mot de passe et refuse les autres", async () => {
    const stored = await hashPassword("un mot de passe solide");
    expect(stored.startsWith("scrypt$131072$8$1$")).toBe(true);
    expect(await verifyPassword("un mot de passe solide", stored)).toBe(true);
    expect(await verifyPassword("un mot de passe solidE", stored)).toBe(false);
  });

  it("sale chaque empreinte différemment", async () => {
    expect(await hashPassword("identique")).not.toBe(await hashPassword("identique"));
  });

  it("refuse une empreinte mal formée", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
  });
});

describe("jeton de session signé", () => {
  it("restitue l'utilisateur d'un jeton valide", async () => {
    const token = await signSession(USER, SECRET);
    expect(await verifySession(token, SECRET)).toMatchObject({ sub: USER.id, email: USER.email });
  });

  it("refuse un jeton absent, falsifié ou signé avec une autre clé", async () => {
    const token = await signSession(USER, SECRET);
    const [body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "11111111-1111-1111-1111-111111111111", email: "x", exp: 9e9 })).toString("base64url");
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession(`${forged}.${signature}`, SECRET)).toBeNull();
    expect(await verifySession(`${body}.${signature}x`, SECRET)).toBeNull();
    expect(await verifySession(`${body}.${signature}.extra`, SECRET)).toBeNull();
    expect(await verifySession(token, "t".repeat(40))).toBeNull();
  });

  it("expire après 30 jours", async () => {
    const now = Date.UTC(2026, 10, 11);
    const token = await signSession(USER, SECRET, now);
    expect(await verifySession(token, SECRET, now + (SESSION_MAX_AGE_SECONDS - 60) * 1000)).not.toBeNull();
    expect(await verifySession(token, SECRET, now + SESSION_MAX_AGE_SECONDS * 1000)).toBeNull();
  });
});
