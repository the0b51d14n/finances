/**
 * Hachage des mots de passe avec scrypt (module crypto de Node, aucune
 * dépendance). Format stocké : scrypt$N$r$p$<sel base64>$<empreinte base64>.
 * Utilisé par l'action de connexion et par scripts/create-user.mts : ce module
 * n'importe donc rien d'autre que node:crypto.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Paramètres recommandés par l'OWASP pour scrypt (N = 2^17, r = 8, p = 1).
const N = 131072;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  // maxmem doit couvrir 128 × N × r octets (128 Mo ici).
  const maxmem = 256 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...options, maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await derive(password, Buffer.from(saltB64, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
