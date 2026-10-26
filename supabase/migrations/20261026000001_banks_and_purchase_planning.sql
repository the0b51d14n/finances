-- =============================================================================
-- Migration 20261026000001 — Banques, compte de dépenses, planification d'achats
-- =============================================================================
-- Migration additive uniquement : aucune donnée existante n'est modifiée ni
-- supprimée. À exécuter après 20261025000001_initial_schema.sql.
--   * accounts.institution          : banque du compte (regroupement à l'affichage)
--   * user_settings.spending_account_id : compte de dépenses courantes (achats,
--                                     enveloppes budgétaires, virements conseillés)
--   * purchase_plans                : date limite, projet (ex. « Emménagement »),
--                                     compte payeur et catégorie de la future dépense
--   * nouvelle catégorie par défaut « Maison, meubles et électroménager »
-- =============================================================================

alter table public.accounts
  add column institution text check (char_length(btrim(institution)) between 1 and 60);

alter table public.user_settings
  add column spending_account_id uuid,
  add constraint user_settings_spending_account_fk
    foreign key (user_id, spending_account_id) references public.accounts (user_id, id)
    on delete set null (spending_account_id);

alter table public.purchase_plans
  add column deadline date,
  add column project text check (char_length(btrim(project)) between 1 and 60),
  add column account_id uuid,
  add column category_id uuid,
  add column category_kind text not null default 'expense' check (category_kind = 'expense'),
  add constraint purchase_plans_account_fk
    foreign key (user_id, account_id) references public.accounts (user_id, id),
  add constraint purchase_plans_category_fk
    foreign key (user_id, category_id, category_kind) references public.categories (user_id, id, kind),
  add constraint purchase_plans_deadline_check
    check (deadline is null or desired_date is null or deadline >= desired_date);

create index purchase_plans_project_idx on public.purchase_plans (user_id, project);

-- Catégorie par défaut supplémentaire (utilisateurs existants et futurs).
insert into public.categories (user_id, kind, name, system_key, sort_order)
select s.user_id, 'expense', 'Maison, meubles et électroménager', 'home_furnishing', 105
  from public.user_settings s
on conflict do nothing;

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
      ('expense', 'Logement et loyer',                  'housing',             10),
      ('expense', 'Énergie et factures',                'energy',              20),
      ('expense', 'Assurances',                         'insurance',           30),
      ('expense', 'Téléphone et Internet',              'telecom',             40),
      ('expense', 'Courses alimentaires',               'groceries',           50),
      ('expense', 'Transport et carburant',             'transport',           60),
      ('expense', 'Santé',                              'health',              70),
      ('expense', 'Abonnements',                        'subscriptions',       80),
      ('expense', 'Loisirs et sorties',                 'leisure',             90),
      ('expense', 'Vêtements',                          'clothing',           100),
      ('expense', 'Maison, meubles et électroménager',  'home_furnishing',    105),
      ('expense', 'Informatique et équipement',         'equipment',          110),
      ('expense', 'Études',                             'studies',            120),
      ('expense', 'Impôts et frais administratifs',     'taxes',              130),
      ('expense', 'Autres dépenses',                    'other_expense',      990),
      ('income',  'Salaire d''alternance',              'salary_apprentice',   10),
      ('income',  'Salaire de job étudiant',            'salary_student_job',  20),
      ('income',  'Aides au logement',                  'housing_aid',         30),
      ('income',  'Prime d''activité',                  'activity_bonus',      40),
      ('income',  'Autres aides',                       'other_aid',           50),
      ('income',  'Tickets-restaurant (crédits)',       'meal_voucher_credit', 60),
      ('income',  'Remboursements',                     'refunds',             70),
      ('income',  'Intérêts d''épargne',                'savings_interest',    80),
      ('income',  'Autres revenus',                     'other_income',       990)
    ) as c(kind, name, system_key, sort_order)
  on conflict do nothing;
end;
$$;

revoke execute on function public.ensure_user_setup() from public, anon;
grant execute on function public.ensure_user_setup() to authenticated;
