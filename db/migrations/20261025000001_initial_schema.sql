-- =============================================================================
-- Migration 20261025000001 — Schéma initial de l'application de finances
-- =============================================================================
-- Règles structurantes (voir docs/REGLES-COMPTABLES.md) :
--   * Tous les montants sont des centimes entiers (bigint). Jamais de flottants.
--   * Une « opération » (transactions) est l'événement logique saisi par
--     l'utilisateur ; ses effets sur les comptes sont des « écritures »
--     (entries) signées. Une dépense = écritures négatives, un revenu =
--     écritures positives, un transfert = deux écritures opposées (somme nulle).
--   * Le solde d'un compte = solde initial + écritures confirmées datées
--     au plus tôt du jour de référence du solde initial.
--   * Les écritures ne sont modifiables que via les fonctions RPC
--     (atomiques, auditées) ; les tables transactions/entries sont en lecture
--     seule pour le rôle authenticated.
--   * Chaque ligne porte user_id ; les clés étrangères composites
--     (user_id, id) empêchent toute référence croisée entre utilisateurs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilitaires
-- -----------------------------------------------------------------------------

create or replace function public.paris_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Paris')::date
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Paramètres utilisateur
-- -----------------------------------------------------------------------------

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- V1 : l'euro est la seule devise de calcul.
  currency text not null default 'EUR' check (currency = 'EUR'),
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  safety_reserve_cents bigint not null default 0 check (safety_reserve_cents >= 0),
  budget_alert_pct integer not null default 80 check (budget_alert_pct between 1 and 100),
  bill_reminder_days integer not null default 7 check (bill_reminder_days between 1 and 60),
  comparison_months integer not null default 6 check (comparison_months between 2 and 24),
  forecast_include_probable boolean not null default false,
  preserve_budgets_in_forecast boolean not null default true,
  notify_budget_alerts boolean not null default true,
  notify_upcoming_bills boolean not null default true,
  notify_low_balance boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Comptes
-- -----------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  type text not null check (type in (
    'checking',          -- compte courant          → argent disponible
    'cash',              -- espèces                 → argent disponible
    'savings',           -- livret d'épargne        → épargne
    'dedicated_savings', -- épargne spécifique      → épargne
    'other',             -- autre réserve           → réserve (hors disponible)
    'meal_voucher'       -- tickets-restaurant      → ressource affectée
  )),
  currency text not null default 'EUR' check (currency = 'EUR'),
  -- Solde du compte au DÉBUT de la journée opening_balance_date,
  -- avant toute opération datée de ce jour.
  opening_balance_cents bigint not null default 0,
  opening_balance_date date not null,
  valid_until date,
  notes text check (char_length(notes) <= 1000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  check (type not in ('cash', 'meal_voucher') or opening_balance_cents >= 0),
  check (valid_until is null or type = 'meal_voucher'),
  check (abs(opening_balance_cents) <= 100000000000)
);

create index accounts_user_idx on public.accounts (user_id);

create trigger accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Catégories (personnalisables ; system_key identifie les catégories par défaut)
-- -----------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  system_key text check (system_key ~ '^[a-z_]{2,40}$'),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, id, kind),
  unique (user_id, system_key)
);

create unique index categories_user_kind_name_uniq
  on public.categories (user_id, kind, lower(name));

-- -----------------------------------------------------------------------------
-- Règles de récurrence (échéances prévues : loyers, salaires, aides…)
-- -----------------------------------------------------------------------------
-- Les occurrences ne sont PAS stockées tant qu'elles ne sont pas réalisées :
-- elles sont calculées à la volée. Confirmer une occurrence crée une
-- opération liée (recurrence_id, occurrence_date), unique par occurrence.
-- Modifier une règle ne touche donc jamais l'historique déjà comptabilisé.

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  label text not null check (char_length(btrim(label)) between 1 and 140),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  account_id uuid not null,
  to_account_id uuid,
  category_id uuid,
  category_kind text generated always as (
    case when kind in ('expense', 'income') then kind end
  ) stored,
  frequency text not null check (frequency in (
    'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual'
  )),
  start_date date not null,
  end_date date,
  -- Les occurrences antérieures à cette date ne sont jamais considérées comme
  -- « à confirmer » : elles sont réputées incluses dans les soldes initiaux.
  tracking_start date not null default public.paris_today(),
  certainty text not null default 'certain' check (certainty in ('certain', 'probable', 'uncertain')),
  is_active boolean not null default true,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  foreign key (user_id, to_account_id) references public.accounts (user_id, id),
  foreign key (user_id, category_id, category_kind) references public.categories (user_id, id, kind),
  check (end_date is null or end_date >= start_date),
  check ((kind = 'transfer') = (to_account_id is not null)),
  check (to_account_id is null or to_account_id <> account_id),
  check ((kind in ('expense', 'income')) = (category_id is not null))
);

create index recurring_rules_user_idx on public.recurring_rules (user_id);

create trigger recurring_rules_updated_at
  before update on public.recurring_rules
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Opérations (événement logique) et écritures (effet sur chaque compte)
-- -----------------------------------------------------------------------------

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income', 'transfer', 'adjustment')),
  status text not null default 'confirmed' check (status in ('planned', 'confirmed', 'cancelled')),
  date date not null check (date between '2000-01-01' and '2100-12-31'),
  label text not null check (char_length(btrim(label)) between 1 and 140),
  notes text check (char_length(notes) <= 2000),
  -- Montant total, toujours positif ; le type détermine l'effet comptable.
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  -- Montant estimé initialement (ressources : estimé vs réellement reçu).
  expected_amount_cents bigint check (expected_amount_cents > 0 and expected_amount_cents <= 100000000000),
  category_id uuid,
  category_kind text generated always as (
    case when kind in ('expense', 'income') then kind end
  ) stored,
  recurrence_id uuid,
  occurrence_date date,
  is_exceptional boolean not null default false,
  client_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (user_id, id),
  -- Anti double soumission : une même requête client ne crée qu'une opération.
  unique (user_id, client_request_id),
  -- Anti doublon : une occurrence de récurrence ne peut être réalisée qu'une fois.
  unique (recurrence_id, occurrence_date),
  foreign key (user_id, category_id, category_kind) references public.categories (user_id, id, kind),
  foreign key (user_id, recurrence_id) references public.recurring_rules (user_id, id),
  check ((kind in ('expense', 'income')) = (category_id is not null)),
  check ((recurrence_id is null) = (occurrence_date is null)),
  check ((status = 'confirmed') = (confirmed_at is not null)),
  check (is_exceptional = false or kind = 'expense')
);

create index transactions_user_date_idx on public.transactions (user_id, date);
create index transactions_category_idx on public.transactions (category_id);
create index transactions_recurrence_idx on public.transactions (recurrence_id);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  account_id uuid not null,
  amount_cents bigint not null check (amount_cents <> 0),
  created_at timestamptz not null default now(),
  foreign key (user_id, transaction_id) references public.transactions (user_id, id) on delete cascade,
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  unique (transaction_id, account_id)
);

create index entries_account_idx on public.entries (account_id);
create index entries_user_idx on public.entries (user_id);

-- Journal d'audit : état complet d'une opération avant chaque modification,
-- changement de statut ou suppression.
create table public.transaction_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  action text not null check (action in ('update', 'status', 'delete')),
  old_data jsonb not null,
  changed_at timestamptz not null default now()
);

create index transaction_audit_user_idx on public.transaction_audit (user_id, transaction_id);

-- -----------------------------------------------------------------------------
-- Intégrité comptable : vérifiée en fin de transaction SQL (contrainte différée)
-- -----------------------------------------------------------------------------

create or replace function public.check_transaction_integrity(p_transaction_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  t record;
  n integer;
  s bigint;
  n_neg integer;
  n_pos integer;
  n_voucher integer;
  max_abs bigint;
begin
  select id, kind, amount_cents into t
    from public.transactions where id = p_transaction_id;
  if not found then
    return; -- opération supprimée : ses écritures le sont aussi (cascade)
  end if;

  select count(*),
         coalesce(sum(e.amount_cents), 0),
         count(*) filter (where e.amount_cents < 0),
         count(*) filter (where e.amount_cents > 0),
         count(*) filter (where a.type = 'meal_voucher'),
         coalesce(max(abs(e.amount_cents)), 0)
    into n, s, n_neg, n_pos, n_voucher, max_abs
    from public.entries e
    join public.accounts a on a.id = e.account_id
   where e.transaction_id = p_transaction_id;

  if t.kind = 'expense' and (n < 1 or n_pos > 0 or s <> -t.amount_cents) then
    raise exception 'ledger_unbalanced' using errcode = '23514',
      detail = 'Une dépense doit avoir des écritures négatives dont la somme vaut -montant.';
  elsif t.kind = 'income' and (n < 1 or n_neg > 0 or s <> t.amount_cents) then
    raise exception 'ledger_unbalanced' using errcode = '23514',
      detail = 'Un revenu doit avoir des écritures positives dont la somme vaut +montant.';
  elsif t.kind = 'transfer' and (n <> 2 or n_neg <> 1 or n_pos <> 1 or s <> 0 or max_abs <> t.amount_cents) then
    raise exception 'ledger_unbalanced' using errcode = '23514',
      detail = 'Un transfert doit avoir exactement deux écritures opposées égales au montant.';
  elsif t.kind = 'transfer' and n_voucher > 0 then
    raise exception 'meal_voucher_transfer' using errcode = '23514',
      detail = 'Un portefeuille de tickets-restaurant ne peut pas faire l''objet d''un transfert.';
  elsif t.kind = 'adjustment' and (n <> 1 or abs(s) <> t.amount_cents) then
    raise exception 'ledger_unbalanced' using errcode = '23514',
      detail = 'Un ajustement doit avoir exactement une écriture égale au montant.';
  end if;
end;
$$;

create or replace function public.trg_entries_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.check_transaction_integrity(new.transaction_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.check_transaction_integrity(old.transaction_id);
  end if;
  return null;
end;
$$;

create or replace function public.trg_transactions_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.check_transaction_integrity(new.id);
  return null;
end;
$$;

create constraint trigger entries_integrity
  after insert or update or delete on public.entries
  deferrable initially deferred
  for each row execute function public.trg_entries_integrity();

create constraint trigger transactions_integrity
  after insert or update on public.transactions
  deferrable initially deferred
  for each row execute function public.trg_transactions_integrity();

-- -----------------------------------------------------------------------------
-- Budgets par catégorie de dépense
-- -----------------------------------------------------------------------------

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  category_kind text not null default 'expense' check (category_kind = 'expense'),
  period text not null check (period in ('weekly', 'monthly')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  alert_pct integer check (alert_pct between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, category_id, category_kind) references public.categories (user_id, id, kind) on delete cascade,
  unique (user_id, category_id, period)
);

create index budgets_user_idx on public.budgets (user_id);

create trigger budgets_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Objectifs d'épargne
-- -----------------------------------------------------------------------------
-- Un objectif AFFECTE une partie de l'argent déjà présent sur les comptes ;
-- il ne s'ajoute jamais aux soldes.
--   tracking = 'account' : montant accumulé = solde du compte associé
--   tracking = 'manual'  : montant accumulé = somme des affectations

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  target_cents bigint not null check (target_cents > 0 and target_cents <= 100000000000),
  target_date date,
  monthly_contribution_cents bigint check (monthly_contribution_cents > 0 and monthly_contribution_cents <= 100000000000),
  priority integer not null default 2 check (priority between 1 and 3),
  tracking text not null default 'manual' check (tracking in ('manual', 'account')),
  account_id uuid,
  achieved_at timestamptz,
  archived_at timestamptz,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  check (tracking = 'manual' or account_id is not null)
);

create index savings_goals_user_idx on public.savings_goals (user_id);

create trigger savings_goals_updated_at
  before update on public.savings_goals
  for each row execute function public.set_updated_at();

create table public.goal_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null,
  date date not null,
  amount_cents bigint not null check (amount_cents <> 0 and abs(amount_cents) <= 100000000000),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.savings_goals (user_id, id) on delete cascade
);

create index goal_allocations_goal_idx on public.goal_allocations (goal_id);

-- -----------------------------------------------------------------------------
-- Achats envisagés (simulateur)
-- -----------------------------------------------------------------------------

create table public.purchase_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  price_cents bigint not null check (price_cents > 0 and price_cents <= 100000000000),
  desired_date date,
  priority integer not null default 2 check (priority between 1 and 3),
  url text check (url ~ '^https?://' and char_length(url) <= 500),
  notes text check (char_length(notes) <= 1000),
  goal_id uuid,
  status text not null default 'active' check (status in ('active', 'purchased', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.savings_goals (user_id, id) on delete set null (goal_id)
);

create index purchase_plans_user_idx on public.purchase_plans (user_id);

create trigger purchase_plans_updated_at
  before update on public.purchase_plans
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Vue : soldes calculés (jamais stockés, donc jamais désynchronisés)
-- -----------------------------------------------------------------------------

create view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.opening_balance_cents
    + coalesce(sum(e.amount_cents) filter (
        where t.status = 'confirmed' and t.date >= a.opening_balance_date
      ), 0) as balance_cents,
  coalesce(sum(e.amount_cents) filter (where t.status = 'planned'), 0) as planned_delta_cents,
  count(e.id) filter (
    where t.status = 'confirmed' and t.date < a.opening_balance_date
  ) as entries_before_opening
from public.accounts a
left join public.entries e on e.account_id = a.id
left join public.transactions t on t.id = e.transaction_id
group by a.id;

-- -----------------------------------------------------------------------------
-- RPC : écriture atomique des opérations
-- -----------------------------------------------------------------------------

create or replace function public.transaction_snapshot(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(t) || jsonb_build_object(
    'entries',
    coalesce((
      select jsonb_agg(jsonb_build_object('account_id', e.account_id, 'amount_cents', e.amount_cents)
                       order by e.amount_cents)
        from public.entries e where e.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  where t.id = p_id
$$;

-- Crée (p.id absent) ou remplace (p.id présent) une opération et ses écritures.
-- Les écritures signées sont calculées par l'application (fonction pure testée)
-- et revérifiées ici par la contrainte différée check_transaction_integrity.
create or replace function public.save_transaction(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_req uuid := nullif(p ->> 'client_request_id', '')::uuid;
  v_status text := coalesce(nullif(p ->> 'status', ''), 'confirmed');
  v_date date := (p ->> 'date')::date;
  v_existing public.transactions;
  v_old_accounts uuid[] := '{}';
  e jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p -> 'entries') is distinct from 'array'
     or jsonb_array_length(p -> 'entries') = 0 then
    raise exception 'entries_required' using errcode = '22023';
  end if;
  if v_status = 'confirmed' and v_date > public.paris_today() then
    raise exception 'confirmed_in_future' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.transactions (
      user_id, kind, status, date, label, notes, amount_cents, expected_amount_cents,
      category_id, recurrence_id, occurrence_date, is_exceptional, client_request_id, confirmed_at
    ) values (
      v_user,
      p ->> 'kind',
      v_status,
      v_date,
      btrim(p ->> 'label'),
      nullif(btrim(coalesce(p ->> 'notes', '')), ''),
      (p ->> 'amount_cents')::bigint,
      nullif(p ->> 'expected_amount_cents', '')::bigint,
      nullif(p ->> 'category_id', '')::uuid,
      nullif(p ->> 'recurrence_id', '')::uuid,
      nullif(p ->> 'occurrence_date', '')::date,
      coalesce((p ->> 'is_exceptional')::boolean, false),
      v_req,
      case when v_status = 'confirmed' then now() end
    )
    on conflict (user_id, client_request_id) do nothing
    returning id into v_id;

    if v_id is null then
      -- Double soumission : on renvoie l'opération déjà créée, sans rien modifier.
      select id into v_id from public.transactions
       where user_id = v_user and client_request_id = v_req;
      return v_id;
    end if;
  else
    select * into v_existing from public.transactions
     where id = v_id and user_id = v_user
     for update;
    if not found then
      raise exception 'transaction_not_found' using errcode = 'P0002';
    end if;

    insert into public.transaction_audit (user_id, transaction_id, action, old_data)
    values (v_user, v_id, 'update', public.transaction_snapshot(v_id));

    select coalesce(array_agg(account_id), '{}') into v_old_accounts
      from public.entries where transaction_id = v_id;

    update public.transactions set
      kind = p ->> 'kind',
      status = v_status,
      date = v_date,
      label = btrim(p ->> 'label'),
      notes = nullif(btrim(coalesce(p ->> 'notes', '')), ''),
      amount_cents = (p ->> 'amount_cents')::bigint,
      expected_amount_cents = nullif(p ->> 'expected_amount_cents', '')::bigint,
      category_id = nullif(p ->> 'category_id', '')::uuid,
      is_exceptional = coalesce((p ->> 'is_exceptional')::boolean, false),
      confirmed_at = case when v_status = 'confirmed' then coalesce(v_existing.confirmed_at, now()) end,
      updated_at = now()
    where id = v_id;

    delete from public.entries where transaction_id = v_id;
  end if;

  for e in select value from jsonb_array_elements(p -> 'entries') loop
    -- Un compte archivé ne reçoit plus de nouvelles écritures
    -- (la modification d'une opération existante sur ce compte reste possible).
    if exists (
      select 1 from public.accounts a
       where a.id = (e ->> 'account_id')::uuid
         and a.user_id = v_user
         and a.archived_at is not null
    ) and not ((e ->> 'account_id')::uuid = any (v_old_accounts)) then
      raise exception 'account_archived' using errcode = '22023';
    end if;

    insert into public.entries (user_id, transaction_id, account_id, amount_cents)
    values (v_user, v_id, (e ->> 'account_id')::uuid, (e ->> 'amount_cents')::bigint);
  end loop;

  return v_id;
end;
$$;

-- Change le statut d'une opération (confirmer une opération prévue, annuler…).
-- p_date permet de fixer la date réelle lors d'une confirmation.
create or replace function public.set_transaction_status(p_id uuid, p_status text, p_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.transactions;
  v_date date;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_status not in ('planned', 'confirmed', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_existing from public.transactions
   where id = p_id and user_id = v_user
   for update;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;

  v_date := coalesce(p_date, v_existing.date);
  if p_status = 'confirmed' and v_date > public.paris_today() then
    raise exception 'confirmed_in_future' using errcode = '22023';
  end if;

  insert into public.transaction_audit (user_id, transaction_id, action, old_data)
  values (v_user, p_id, 'status', public.transaction_snapshot(p_id));

  update public.transactions set
    status = p_status,
    date = v_date,
    confirmed_at = case when p_status = 'confirmed' then coalesce(v_existing.confirmed_at, now()) end,
    updated_at = now()
  where id = p_id;
end;
$$;

create or replace function public.delete_transaction(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.transactions where id = p_id and user_id = v_user) then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;

  insert into public.transaction_audit (user_id, transaction_id, action, old_data)
  values (v_user, p_id, 'delete', public.transaction_snapshot(p_id));

  delete from public.transactions where id = p_id and user_id = v_user;
end;
$$;

-- Supprime une règle de récurrence. Les opérations déjà réalisées sont
-- conservées et détachées de la règle (l'historique reste intact).
create or replace function public.delete_recurring_rule(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.recurring_rules where id = p_id and user_id = v_user) then
    raise exception 'rule_not_found' using errcode = 'P0002';
  end if;

  update public.transactions
     set recurrence_id = null, occurrence_date = null, updated_at = now()
   where recurrence_id = p_id and user_id = v_user;

  delete from public.recurring_rules where id = p_id and user_id = v_user;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : initialisation et suppression des données utilisateur
-- -----------------------------------------------------------------------------

-- Idempotente : crée les paramètres et les catégories par défaut manquantes.
create or replace function public.ensure_user_setup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.user_settings (user_id) values (v_user)
  on conflict (user_id) do nothing;

  insert into public.categories (user_id, kind, name, system_key, sort_order)
  select v_user, c.kind, c.name, c.system_key, c.sort_order
    from (values
      ('expense', 'Logement et loyer',               'housing',             10),
      ('expense', 'Énergie et factures',             'energy',              20),
      ('expense', 'Assurances',                      'insurance',           30),
      ('expense', 'Téléphone et Internet',           'telecom',             40),
      ('expense', 'Courses alimentaires',            'groceries',           50),
      ('expense', 'Transport et carburant',          'transport',           60),
      ('expense', 'Santé',                           'health',              70),
      ('expense', 'Abonnements',                     'subscriptions',       80),
      ('expense', 'Loisirs et sorties',              'leisure',             90),
      ('expense', 'Vêtements',                       'clothing',           100),
      ('expense', 'Informatique et équipement',      'equipment',          110),
      ('expense', 'Études',                          'studies',            120),
      ('expense', 'Impôts et frais administratifs',  'taxes',              130),
      ('expense', 'Autres dépenses',                 'other_expense',      990),
      ('income',  'Salaire d''alternance',           'salary_apprentice',   10),
      ('income',  'Salaire de job étudiant',         'salary_student_job',  20),
      ('income',  'Aides au logement',               'housing_aid',         30),
      ('income',  'Prime d''activité',               'activity_bonus',      40),
      ('income',  'Autres aides',                    'other_aid',           50),
      ('income',  'Tickets-restaurant (crédits)',    'meal_voucher_credit', 60),
      ('income',  'Remboursements',                  'refunds',             70),
      ('income',  'Intérêts d''épargne',             'savings_interest',    80),
      ('income',  'Autres revenus',                  'other_income',       990)
    ) as c(kind, name, system_key, sort_order)
  on conflict do nothing;
end;
$$;

-- Suppression définitive de toutes les données financières de l'utilisateur.
create or replace function public.delete_all_my_data(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_confirmation is distinct from 'SUPPRIMER' then
    raise exception 'confirmation_required' using errcode = '22023';
  end if;

  delete from public.transaction_audit where user_id = v_user;
  delete from public.goal_allocations where user_id = v_user;
  delete from public.purchase_plans where user_id = v_user;
  delete from public.savings_goals where user_id = v_user;
  delete from public.budgets where user_id = v_user;
  delete from public.transactions where user_id = v_user; -- écritures en cascade
  delete from public.recurring_rules where user_id = v_user;
  delete from public.categories where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.user_settings where user_id = v_user;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sécurité : RLS et privilèges
-- -----------------------------------------------------------------------------

alter table public.user_settings enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.transactions enable row level security;
alter table public.entries enable row level security;
alter table public.transaction_audit enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.goal_allocations enable row level security;
alter table public.purchase_plans enable row level security;

-- Tables modifiables directement par leur propriétaire.
create policy user_settings_own on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy accounts_own on public.accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy categories_own on public.categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy recurring_rules_own on public.recurring_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy budgets_own on public.budgets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy savings_goals_own on public.savings_goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goal_allocations_own on public.goal_allocations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy purchase_plans_own on public.purchase_plans for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Tables comptables : lecture seule, écriture uniquement via les RPC.
create policy transactions_read_own on public.transactions for select to authenticated
  using (user_id = (select auth.uid()));
create policy entries_read_own on public.entries for select to authenticated
  using (user_id = (select auth.uid()));
create policy transaction_audit_read_own on public.transaction_audit for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on public.transactions, public.entries, public.transaction_audit
  from authenticated;
-- La suppression des paramètres passe par delete_all_my_data.
revoke delete on public.user_settings from authenticated;

grant select on public.account_balances to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.paris_today(),
  public.save_transaction(jsonb),
  public.set_transaction_status(uuid, text, date),
  public.delete_transaction(uuid),
  public.delete_recurring_rule(uuid),
  public.ensure_user_setup(),
  public.delete_all_my_data(text)
to authenticated;
