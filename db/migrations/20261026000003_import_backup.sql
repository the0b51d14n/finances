-- =============================================================================
-- Migration 20261026000003 — Réimport d'une sauvegarde JSON
--
-- import_backup(p) restaure une sauvegarde (préparée et vérifiée par
-- src/lib/backup.ts) en une seule transaction :
--   * uniquement dans un espace vide (aucun compte, opération, échéance,
--     budget, objectif ni achat) : rien n'est jamais écrasé ni supprimé ;
--   * tous les identifiants sont régénérés (ancien → nouveau), la sauvegarde
--     peut donc être restaurée sur un autre compte utilisateur ;
--   * les catégories par défaut sont reprises par leur clé système ;
--   * les contraintes habituelles (dont l'équilibre des écritures, vérifié en
--     fin de transaction) s'appliquent : au moindre écart, rien n'est importé.
--
-- Migration additive : une fonction ajoutée, aucune donnée modifiée.
-- =============================================================================

create or replace function public.import_backup(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  m jsonb := '{}'::jsonb; -- identifiant de la sauvegarde → nouvel identifiant
  r jsonb;
  e jsonb;
  s jsonb;
  v_id uuid;
  n_tx integer := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.accounts where user_id = v_user)
     or exists (select 1 from public.transactions where user_id = v_user)
     or exists (select 1 from public.recurring_rules where user_id = v_user)
     or exists (select 1 from public.budgets where user_id = v_user)
     or exists (select 1 from public.savings_goals where user_id = v_user)
     or exists (select 1 from public.purchase_plans where user_id = v_user) then
    raise exception 'import_requires_empty' using errcode = '22023';
  end if;

  perform public.ensure_user_setup();

  -- Catégories : d'abord celles par défaut (clé système), puis les personnalisées,
  -- rattachées à une catégorie existante de même nom si elle existe.
  for r in
    select value from jsonb_array_elements(coalesce(p -> 'categories', '[]'::jsonb))
     order by (value ->> 'system_key') is null
  loop
    v_id := null;
    if r ->> 'system_key' is not null then
      select id into v_id from public.categories
       where user_id = v_user and system_key = r ->> 'system_key' and kind = r ->> 'kind';
      if v_id is not null then
        update public.categories
           set name = r ->> 'name',
               color = r ->> 'color',
               sort_order = coalesce((r ->> 'sort_order')::integer, sort_order),
               archived_at = (r ->> 'archived_at')::timestamptz
         where id = v_id;
      end if;
    end if;
    if v_id is null then
      select id into v_id from public.categories
       where user_id = v_user and kind = r ->> 'kind' and lower(name) = lower(r ->> 'name');
    end if;
    if v_id is null then
      insert into public.categories (user_id, kind, name, color, sort_order, archived_at)
      values (v_user, r ->> 'kind', r ->> 'name', r ->> 'color',
              coalesce((r ->> 'sort_order')::integer, 500), (r ->> 'archived_at')::timestamptz)
      returning id into v_id;
    end if;
    m := m || jsonb_build_object(r ->> 'id', v_id);
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p -> 'accounts', '[]'::jsonb)) loop
    insert into public.accounts (
      user_id, name, type, subtype, opening_balance_cents, opening_balance_date,
      valid_until, institution, notes, archived_at
    ) values (
      v_user, r ->> 'name', r ->> 'type', r ->> 'subtype', (r ->> 'opening_balance_cents')::bigint,
      (r ->> 'opening_balance_date')::date, (r ->> 'valid_until')::date, r ->> 'institution',
      r ->> 'notes', (r ->> 'archived_at')::timestamptz
    )
    returning id into v_id;
    m := m || jsonb_build_object(r ->> 'id', v_id);
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p -> 'rules', '[]'::jsonb)) loop
    insert into public.recurring_rules (
      user_id, kind, label, amount_cents, account_id, to_account_id, category_id, frequency,
      start_date, end_date, tracking_start, certainty, is_active, notes
    ) values (
      v_user, r ->> 'kind', r ->> 'label', (r ->> 'amount_cents')::bigint,
      (m ->> (r ->> 'account_id'))::uuid, (m ->> (r ->> 'to_account_id'))::uuid,
      (m ->> (r ->> 'category_id'))::uuid, r ->> 'frequency', (r ->> 'start_date')::date,
      (r ->> 'end_date')::date, (r ->> 'tracking_start')::date, r ->> 'certainty',
      (r ->> 'is_active')::boolean, r ->> 'notes'
    )
    returning id into v_id;
    m := m || jsonb_build_object(r ->> 'id', v_id);
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p -> 'transactions', '[]'::jsonb)) loop
    insert into public.transactions (
      user_id, kind, status, date, label, notes, amount_cents, expected_amount_cents,
      category_id, recurrence_id, occurrence_date, is_exceptional, created_at, confirmed_at
    ) values (
      v_user, r ->> 'kind', r ->> 'status', (r ->> 'date')::date, r ->> 'label', r ->> 'notes',
      (r ->> 'amount_cents')::bigint, (r ->> 'expected_amount_cents')::bigint,
      (m ->> (r ->> 'category_id'))::uuid, (m ->> (r ->> 'recurrence_id'))::uuid,
      (r ->> 'occurrence_date')::date, coalesce((r ->> 'is_exceptional')::boolean, false),
      coalesce((r ->> 'created_at')::timestamptz, now()),
      case when r ->> 'status' = 'confirmed' then coalesce((r ->> 'confirmed_at')::timestamptz, now()) end
    )
    returning id into v_id;
    for e in select value from jsonb_array_elements(r -> 'entries') loop
      insert into public.entries (user_id, transaction_id, account_id, amount_cents)
      values (v_user, v_id, (m ->> (e ->> 'account_id'))::uuid, (e ->> 'amount_cents')::bigint);
    end loop;
    n_tx := n_tx + 1;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p -> 'budgets', '[]'::jsonb)) loop
    insert into public.budgets (user_id, category_id, period, amount_cents, alert_pct, is_active)
    values (v_user, (m ->> (r ->> 'category_id'))::uuid, r ->> 'period', (r ->> 'amount_cents')::bigint,
            (r ->> 'alert_pct')::integer, (r ->> 'is_active')::boolean);
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p -> 'goals', '[]'::jsonb)) loop
    insert into public.savings_goals (
      user_id, name, target_cents, target_date, monthly_contribution_cents, priority, tracking,
      account_id, achieved_at, archived_at, notes
    ) values (
      v_user, r ->> 'name', (r ->> 'target_cents')::bigint, (r ->> 'target_date')::date,
      (r ->> 'monthly_contribution_cents')::bigint, (r ->> 'priority')::integer, r ->> 'tracking',
      (m ->> (r ->> 'account_id'))::uuid, (r ->> 'achieved_at')::timestamptz,
      (r ->> 'archived_at')::timestamptz, r ->> 'notes'
    )
    returning id into v_id;
    m := m || jsonb_build_object(r ->> 'id', v_id);
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p -> 'allocations', '[]'::jsonb)) loop
    insert into public.goal_allocations (user_id, goal_id, date, amount_cents, note)
    values (v_user, (m ->> (r ->> 'goal_id'))::uuid, (r ->> 'date')::date, (r ->> 'amount_cents')::bigint, r ->> 'note');
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p -> 'purchase_plans', '[]'::jsonb)) loop
    insert into public.purchase_plans (
      user_id, name, price_cents, desired_date, priority, url, notes, goal_id, status,
      deadline, project, account_id, category_id
    ) values (
      v_user, r ->> 'name', (r ->> 'price_cents')::bigint, (r ->> 'desired_date')::date,
      (r ->> 'priority')::integer, r ->> 'url', r ->> 'notes', (m ->> (r ->> 'goal_id'))::uuid,
      r ->> 'status', (r ->> 'deadline')::date, r ->> 'project',
      (m ->> (r ->> 'account_id'))::uuid, (m ->> (r ->> 'category_id'))::uuid
    );
  end loop;

  s := p -> 'settings';
  if jsonb_typeof(s) = 'object' then
    update public.user_settings set
      theme = coalesce(s ->> 'theme', theme),
      safety_reserve_cents = coalesce((s ->> 'safety_reserve_cents')::bigint, safety_reserve_cents),
      budget_alert_pct = coalesce((s ->> 'budget_alert_pct')::integer, budget_alert_pct),
      bill_reminder_days = coalesce((s ->> 'bill_reminder_days')::integer, bill_reminder_days),
      comparison_months = coalesce((s ->> 'comparison_months')::integer, comparison_months),
      forecast_include_probable = coalesce((s ->> 'forecast_include_probable')::boolean, forecast_include_probable),
      preserve_budgets_in_forecast = coalesce((s ->> 'preserve_budgets_in_forecast')::boolean, preserve_budgets_in_forecast),
      notify_budget_alerts = coalesce((s ->> 'notify_budget_alerts')::boolean, notify_budget_alerts),
      notify_upcoming_bills = coalesce((s ->> 'notify_upcoming_bills')::boolean, notify_upcoming_bills),
      notify_low_balance = coalesce((s ->> 'notify_low_balance')::boolean, notify_low_balance),
      spending_account_id = (m ->> (s ->> 'spending_account_id'))::uuid
    where user_id = v_user;
  end if;

  return jsonb_build_object(
    'accounts', jsonb_array_length(coalesce(p -> 'accounts', '[]'::jsonb)),
    'transactions', n_tx,
    'rules', jsonb_array_length(coalesce(p -> 'rules', '[]'::jsonb)),
    'goals', jsonb_array_length(coalesce(p -> 'goals', '[]'::jsonb)),
    'purchases', jsonb_array_length(coalesce(p -> 'purchase_plans', '[]'::jsonb))
  );
end;
$$;

revoke execute on function public.import_backup(jsonb) from public, anon;
grant execute on function public.import_backup(jsonb) to authenticated;
