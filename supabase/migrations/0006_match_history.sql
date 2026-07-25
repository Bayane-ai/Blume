-- Bloc 4 (isolation par compte) : la page "Historique" (matchs consultés) passe du
-- localStorage (isolé par NAVIGATEUR, pas par COMPTE) à une vraie table Supabase
-- personnelle, comme search_history/favorites (voir supabase/migrations/0001) — pour
-- qu'un compte retrouve son historique sur n'importe quel appareil, et que Row Level
-- Security en garantisse l'isolement réel entre comptes (jamais un simple "personne
-- d'autre n'a cette clé de localStorage").
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

create table if not exists match_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id text not null,
  status text,
  minute integer,
  utc_date timestamptz,
  competition_code text,
  competition_name text,
  competition_emblem text,
  home_team_id text,
  home_team_name text,
  home_team_crest text,
  away_team_id text,
  away_team_name text,
  away_team_crest text,
  score_home integer,
  score_away integer,
  added_at timestamptz not null default now(),
  unique (user_id, match_id)
);

alter table match_history enable row level security;

create policy "match_history_select_own"
  on match_history for select
  using (auth.uid() = user_id);

create policy "match_history_insert_own"
  on match_history for insert
  with check (auth.uid() = user_id);

-- "update" nécessaire pour l'upsert qui remonte une entrée déjà présente en tête et
-- remet son délai d'effacement à zéro (voir lib/matchHistory.js), plutôt que de
-- supprimer puis réinsérer (unique (user_id, match_id) rend l'upsert direct possible).
create policy "match_history_update_own"
  on match_history for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- "delete" nécessaire pour le nettoyage des entrées de plus de 10 jours (voir
-- lib/matchHistory.js), déclenché à chaque chargement de la page Historique.
create policy "match_history_delete_own"
  on match_history for delete
  using (auth.uid() = user_id);

create index if not exists match_history_user_added_idx
  on match_history (user_id, added_at desc);
