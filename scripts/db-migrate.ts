/**
 * Applique à la base Neon les migrations de db/migrations non encore exécutées,
 * dans l'ordre, chacune dans sa propre transaction (tout ou rien).
 * Les migrations appliquées sont inscrites dans meta.schema_migrations : le
 * script peut être relancé sans risque.
 *
 * Usage : npm run db:migrate   (lit DATABASE_URL dans .env.local ou l'environnement)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, neonConfig } from "@neondatabase/serverless";

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

// Connexion WebSocket (requise pour exécuter des fichiers SQL complets).
neonConfig.webSocketConstructor = WebSocket;

const dir = join(process.cwd(), "db", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new Client(url);
await client.connect();
try {
  await client.query(`
    create schema if not exists meta;
    create table if not exists meta.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
    revoke all on schema meta from public;`);
  const { rows } = await client.query<{ name: string }>("select name from meta.schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) console.log(`Base à jour (${files.length} migrations déjà appliquées).`);

  for (const file of pending) {
    await client.query("begin");
    try {
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("insert into meta.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`✓ ${file}`);
    } catch (e) {
      await client.query("rollback");
      console.error(`✗ ${file} : ${(e as Error).message}`);
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end();
}
