-- Historique des combinés "Combiné Vision" (BLOC 4.B : Gagné/Perdu/En cours +
-- taux de réussite par niveau de risque) — GLOBAL, pas de user_id : comme
-- pronostic_history, c'est le bilan du site sur les combinés qu'il a proposés, pas un
-- historique personnel (voir lib/comboHistory.js). RLS ouverte (lecture ET écriture),
-- même raison que pronostic_history : le site n'a pas de clé Supabase secrète séparée
-- du navigateur (uniquement NEXT_PUBLIC_SUPABASE_ANON_KEY).
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

create table if not exists combo_history (
  id uuid primary key default gen_random_uuid(),
  combo_id text not null unique,
  risk_level text not null check (risk_level in ('faible', 'moyen', 'eleve')),
  is_live boolean not null default false,
  -- Sélections détaillées (matchId, équipes, marché/pronostic choisi, métadonnée de
  -- vérification) — jamais le pronostic complet ni un objet éphémère (voir
  -- lib/comboHistory.js, toComboSnapshot).
  legs jsonb not null,
  confidence numeric,
  match_date timestamptz,
  saved_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'success', 'failure')),
  verified_at timestamptz
);

alter table combo_history enable row level security;

create policy "combo_history_select_all"
  on combo_history for select
  using (true);

create policy "combo_history_insert_all"
  on combo_history for insert
  with check (true);

create policy "combo_history_update_all"
  on combo_history for update
  using (true);

create policy "combo_history_delete_all"
  on combo_history for delete
  using (true);

create index if not exists combo_history_status_idx
  on combo_history (status, risk_level);

create index if not exists combo_history_match_date_idx
  on combo_history (match_date);
