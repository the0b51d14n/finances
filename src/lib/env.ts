/**
 * Variables d'environnement du serveur (jamais préfixées NEXT_PUBLIC_ : elles
 * ne sont donc jamais incluses dans le code envoyé au navigateur).
 *  - DATABASE_URL : chaîne de connexion Neon PostgreSQL ;
 *  - AUTH_SECRET  : clé de signature des cookies de session (32 caractères min.).
 */
export type ServerEnv = { databaseUrl: string; authSecret: string };

const MIN_SECRET_LENGTH = 32;

export function getServerEnv(): ServerEnv | null {
  const databaseUrl = process.env.DATABASE_URL;
  const authSecret = process.env.AUTH_SECRET;
  if (!databaseUrl || !authSecret || authSecret.length < MIN_SECRET_LENGTH) return null;
  return { databaseUrl, authSecret };
}

export class ConfigurationError extends Error {
  constructor() {
    super("Configuration incomplète : définissez DATABASE_URL et AUTH_SECRET (32 caractères minimum), voir README.");
    this.name = "ConfigurationError";
  }
}

export function requireServerEnv(): ServerEnv {
  const env = getServerEnv();
  if (!env) throw new ConfigurationError();
  return env;
}
