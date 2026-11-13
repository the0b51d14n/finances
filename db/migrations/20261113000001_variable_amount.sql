-- =============================================================================
-- Échéance à montant variable (salaire avec heures supplémentaires, facture
-- d'énergie…) : elle est enregistrée automatiquement au montant prévu, puis
-- l'accueil rappelle de saisir le montant réel tant que l'opération n'a pas
-- été modifiée. Ce n'est pas une confirmation : l'opération compte déjà.
-- =============================================================================

alter table public.recurring_rules
  add column if not exists variable_amount boolean not null default false;
