-- Historique des pronostics vérifiés (boutons "Probabilités réussies" /
-- "Probabilités échouées") — GLOBAL, pas de user_id : c'est le bilan du site sur les
-- matchs qu'il a analysés, pas un historique personnel (voir lib/pronosticHistory.js).
-- RLS ouverte (lecture ET écriture) : le site n'a pas de clé Supabase secrète séparée
-- du navigateur (uniquement NEXT_PUBLIC_SUPABASE_ANON_KEY, comme pour search_history/
-- favorites) — cette table ne contient aucune donnée personnelle ou sensible.
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

create table if not exists pronostic_history (
  id uuid primary key default gen_random_uuid(),
  match_id text not null unique,
  competition_code text,
  home_team_name text not null,
  away_team_name text not null,
  match_date timestamptz,
  prediction jsonb not null,
  saved_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'success', 'failure')),
  final_score jsonb,
  verified_at timestamptz
);

alter table pronostic_history enable row level security;

create policy "pronostic_history_select_all"
  on pronostic_history for select
  using (true);

create policy "pronostic_history_insert_all"
  on pronostic_history for insert
  with check (true);

create policy "pronostic_history_update_all"
  on pronostic_history for update
  using (true);

create policy "pronostic_history_delete_all"
  on pronostic_history for delete
  using (true);

create index if not exists pronostic_history_status_idx
  on pronostic_history (status, match_date desc);
