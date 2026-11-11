-- =============================================================================
-- Date d'expiration (valid_until) : en plus des tickets-restaurant, elle est
-- permise pour les ressources affectées (cartes cadeaux, avoirs et bons
-- d'achat, chèques-vacances, titres de transport prépayés, avantages salariés).
-- Aucune donnée n'est modifiée : seule la contrainte est élargie.
-- =============================================================================

do $$
declare
  c record;
begin
  -- La contrainte d'origine n'a pas de nom explicite : on la retrouve par sa définition.
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.accounts'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%valid_until%'
  loop
    execute format('alter table public.accounts drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.accounts
  add constraint accounts_valid_until_check
  check (valid_until is null or type in ('meal_voucher', 'earmarked'));
