/**
 * Variables d'environnement publiques de Supabase.
 * La clé publiable (anon) est conçue pour être exposée : la sécurité repose
 * sur la RLS. Aucune clé secrète (service_role) n'est utilisée par l'application.
 */
export type SupabaseEnv = { url: string; key: string };

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export class ConfigurationError extends Error {
  constructor() {
    super(
      "Configuration incomplète : définissez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (voir README).",
    );
    this.name = "ConfigurationError";
  }
}

export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv();
  if (!env) throw new ConfigurationError();
  return env;
}
