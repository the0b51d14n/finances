/**
 * Crée l'utilisateur de l'application, ou change son mot de passe s'il existe.
 * Il n'y a pas d'inscription publique : c'est le seul moyen de créer un compte.
 *
 * Usage : npm run user:create   (lit DATABASE_URL dans .env.local ou l'environnement)
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { neon } from "@neondatabase/serverless";
import { hashPassword } from "../src/lib/auth/password.ts";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // fichier absent : variables lues dans l'environnement
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquante (voir .env.example).");
  process.exit(1);
}

// Saisie du mot de passe sans écho à l'écran.
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({ input: stdin, output, terminal: true });

async function askHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  muted = true;
  const answer = await rl.question("");
  muted = false;
  stdout.write("\n");
  return answer;
}

const email = (await rl.question("Adresse e-mail : ")).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Adresse e-mail invalide.");
  process.exit(1);
}
const password = await askHidden("Mot de passe (8 à 72 caractères) : ");
if (password.length < 8 || password.length > 72) {
  console.error("Le mot de passe doit contenir entre 8 et 72 caractères.");
  process.exit(1);
}
if ((await askHidden("Confirmez le mot de passe : ")) !== password) {
  console.error("Les deux mots de passe diffèrent.");
  process.exit(1);
}
rl.close();

const sql = neon(url);
const [user] = await sql.query(
  `insert into auth.users (email, password_hash) values ($1, $2)
   on conflict (email) do update set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null
   returning id, (xmax = 0) as created`,
  [email, await hashPassword(password)],
);
console.log(user.created ? `Utilisateur créé (${email}).` : `Mot de passe mis à jour (${email}).`);
