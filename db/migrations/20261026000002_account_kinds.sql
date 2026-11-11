-- =============================================================================
-- Migration 20261026000002 — Natures de comptes détaillées
--
-- * accounts.subtype : nature précise du compte (Livret A, PEA, crédit
--   immobilier…). Liste et correspondance avec le type : voir
--   src/lib/domain/account-kinds.ts.
-- * Trois nouveaux types comptables :
--     investment → placements (valeur fluctuante, comptés dans le total)
--     debt       → crédits et dettes (solde ≤ 0, jamais de l'argent disponible)
--     earmarked  → avantages affectés (cartes cadeaux, chèques-vacances…),
--                  hors total et sans transfert, comme les tickets-restaurant
--
-- Migration additive : aucune donnée supprimée. Les comptes existants reçoivent
-- la nature par défaut de leur type ; leur comportement est inchangé.
-- =============================================================================

alter table public.accounts drop constraint accounts_type_check;
alter table public.accounts add constraint accounts_type_check check (type in (
  'checking',          -- compte courant          → argent disponible
  'cash',              -- espèces                 → argent disponible
  'savings',           -- livret d'épargne        → épargne
  'dedicated_savings', -- épargne spécifique      → épargne
  'other',             -- autre réserve           → réserve (hors disponible)
  'meal_voucher',      -- tickets-restaurant      → ressource affectée
  'investment',        -- placement               → placements
  'debt',              -- crédit ou dette         → dettes
  'earmarked'          -- avantage affecté        → ressource affectée
));

alter table public.accounts
  add constraint accounts_opening_sign_check check (
    (type <> 'earmarked' or opening_balance_cents >= 0)
    and (type <> 'debt' or opening_balance_cents <= 0)
  );

alter table public.accounts add column subtype text;

update public.accounts
   set subtype = case type
     when 'checking' then 'current'
     when 'cash' then 'cash'
     when 'savings' then 'savings_account'
     when 'dedicated_savings' then 'goal_savings'
     when 'other' then 'other_reserve'
     when 'meal_voucher' then 'meal_voucher'
   end
 where subtype is null;

alter table public.accounts
  add constraint accounts_subtype_check check (
    subtype is null or type = coalesce(case subtype
      when 'current' then 'checking'
      when 'joint' then 'checking'
      when 'secondary' then 'checking'
      when 'professional' then 'checking'
      when 'online_payment' then 'checking'
      when 'mobile_payment' then 'checking'
      when 'cash' then 'cash'
      when 'prepaid_card' then 'cash'
      when 'e_wallet' then 'cash'
      when 'meal_voucher' then 'meal_voucher'
      when 'gift_card' then 'earmarked'
      when 'store_credit' then 'earmarked'
      when 'transport_credit' then 'earmarked'
      when 'holiday_vouchers' then 'earmarked'
      when 'employee_benefits' then 'earmarked'
      when 'savings_account' then 'savings'
      when 'livret_a' then 'savings'
      when 'ldds' then 'savings'
      when 'lep' then 'savings'
      when 'livret_jeune' then 'savings'
      when 'pel' then 'savings'
      when 'cel' then 'savings'
      when 'term_deposit' then 'savings'
      when 'goal_savings' then 'dedicated_savings'
      when 'other_reserve' then 'other'
      when 'online_kitty' then 'other'
      when 'cashback' then 'other'
      when 'custom' then 'other'
      when 'cto' then 'investment'
      when 'pea' then 'investment'
      when 'life_insurance' then 'investment'
      when 'per' then 'investment'
      when 'crypto' then 'investment'
      when 'stocks_etf' then 'investment'
      when 'bonds' then 'investment'
      when 'crowdfunding' then 'investment'
      when 'mortgage' then 'debt'
      when 'consumer_loan' then 'debt'
      when 'student_loan' then 'debt'
      when 'personal_debt' then 'debt'
    end, '#nature inconnue')
  );

-- Les avantages affectés suivent la règle des tickets-restaurant : aucun transfert.
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
         count(*) filter (where a.type in ('meal_voucher', 'earmarked')),
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
      detail = 'Un portefeuille de tickets-restaurant ou un avantage affecté ne peut pas faire l''objet d''un transfert.';
  elsif t.kind = 'adjustment' and (n <> 1 or abs(s) <> t.amount_cents) then
    raise exception 'ledger_unbalanced' using errcode = '23514',
      detail = 'Un ajustement doit avoir exactement une écriture égale au montant.';
  end if;
end;
$$;
