-- =============================================================================
-- Authentification et rôles (remplace le strict nécessaire de Supabase Auth).
--
-- Les migrations suivantes s'appuient sur trois éléments fournis autrefois par
-- Supabase, recréés ici à l'identique sur un PostgreSQL standard (Neon) :
--   - auth.users  : les utilisateurs (référencés par toutes les tables) ;
--   - auth.uid()  : l'utilisateur de la requête, lu dans le paramètre de session
--                   request.jwt.claim.sub posé par le serveur Next.js ;
--   - les rôles anon / authenticated : chaque requête de l'application
--     s'exécute sous le rôle authenticated, donc sous RLS.
-- Le mot de passe est stocké haché (scrypt, voir src/lib/auth/password.ts).
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  password_hash text not null,
  -- Limitation des essais de connexion (verrouillage temporaire).
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  -- Le rôle de connexion de l'application doit pouvoir endosser authenticated
  -- (set local role authenticated au début de chaque transaction).
  execute format('grant authenticated to %I', current_user);
end
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
-- auth.users n'est accessible qu'au rôle de connexion (jamais sous authenticated).
revoke all on auth.users from public, anon, authenticated;

-- Privilèges par défaut équivalents à ceux de Supabase : les migrations
-- suivantes restreignent ensuite tables et fonctions (revoke / RLS).
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
