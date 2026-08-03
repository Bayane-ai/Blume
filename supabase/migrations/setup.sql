-- Bloc UNIQUE, rejouable sans erreur autant de fois que nécessaire (create table if
-- not exists, add column if not exists, drop policy if exists avant chaque create
-- policy) — reconstruit l'état FINAL attendu du schéma Supabase de ce projet, tel
-- qu'utilisé aujourd'hui par le code (pages/api/**, lib/**). Aucune dépendance à un
-- ordre d'exécution externe : ce fichier suffit seul, sur une base neuve ou déjà
-- partiellement migrée.
--
-- Ce fichier NE REJOUE PAS les étapes de transformation historiques (TRUNCATE,
-- DROP TABLE, changements de colonnes) des migrations numérotées 0001 à 0016 : ces
-- étapes ont déjà eu lieu en production et les rejouer purement et simplement
-- effacerait des données réelles (comptes, historiques). Il écrit directement le
-- schéma final voulu, de façon idempotente — strictement équivalent au résultat des
-- migrations 0001 à 0016 déjà appliquées, sans aucune de leurs opérations
-- destructives. Les fichiers 0001-0016 restent dans ce dossier pour l'historique ;
-- setup.sql est la seule référence à jour à exécuter désormais.

create extension if not exists pgcrypto;

-- ============================================================================
-- profiles — une ligne par compte (voir lib/session.js, pages/api/auth/login.js).
-- Authentification maison (cookie JWT signé par le serveur) : plus aucun lien avec
-- auth.users ni Supabase Auth. RLS activée SANS AUCUNE policy — seule la clé
-- service_role (lib/supabaseAdmin.js, jamais côté navigateur) peut lire/écrire cette
-- table ; l'isolation entre comptes est assurée par le code serveur (filtré par
-- session.id), jamais par Postgres.
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
alter table public.profiles add column if not exists id uuid primary key default gen_random_uuid();
alter table public.profiles add column if not exists email text unique not null;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

-- ============================================================================
-- search_history — historique de recherche personnel (voir lib/personalization.js,
-- pages/api/search-history.js). RLS activée, AUCUNE policy (même principe que
-- profiles) : filtré côté serveur par profile_id de la session.
-- ============================================================================
create table if not exists public.search_history (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now()
);
alter table public.search_history enable row level security;
drop policy if exists "search_history_select_own" on public.search_history;
drop policy if exists "search_history_insert_own" on public.search_history;
drop policy if exists "search_history_delete_own" on public.search_history;
create index if not exists search_history_profile_created_idx
  on public.search_history (profile_id, created_at desc);

-- ============================================================================
-- favorites — compétitions/équipes favorites (voir pages/api/favorites.js). Même
-- principe RLS que search_history.
-- ============================================================================
create table if not exists public.favorites (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('competition', 'team')),
  ref_id text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, kind, ref_id)
);
alter table public.favorites enable row level security;
drop policy if exists "favorites_select_own" on public.favorites;
drop policy if exists "favorites_insert_own" on public.favorites;
drop policy if exists "favorites_delete_own" on public.favorites;

-- ============================================================================
-- match_history — matchs consultés par compte, tous sports confondus (voir
-- lib/matchHistory.js, pages/api/match-history.js). Même principe RLS.
-- ============================================================================
create table if not exists public.match_history (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
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
  unique (profile_id, match_id)
);
alter table public.match_history enable row level security;
drop policy if exists "match_history_select_own" on public.match_history;
drop policy if exists "match_history_insert_own" on public.match_history;
drop policy if exists "match_history_update_own" on public.match_history;
drop policy if exists "match_history_delete_own" on public.match_history;
create index if not exists match_history_profile_added_idx
  on public.match_history (profile_id, added_at desc);

-- ============================================================================
-- pronostic_history — bilan GLOBAL du site (Probabilités réussies/échouées), tous
-- sports confondus (voir lib/pronosticHistory.js et ses équivalents basket/tennis).
-- PAS de données personnelles : RLS activée AVEC policies ouvertes (lecture/écriture
-- libres), le site n'utilisant qu'une clé anonyme côté navigateur pour ce contenu
-- global — jamais de user_id/profile_id ici.
-- ============================================================================
create table if not exists public.pronostic_history (
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
alter table public.pronostic_history add column if not exists sport text not null default 'football';
alter table public.pronostic_history enable row level security;
drop policy if exists "pronostic_history_select_all" on public.pronostic_history;
create policy "pronostic_history_select_all" on public.pronostic_history for select using (true);
drop policy if exists "pronostic_history_insert_all" on public.pronostic_history;
create policy "pronostic_history_insert_all" on public.pronostic_history for insert with check (true);
drop policy if exists "pronostic_history_update_all" on public.pronostic_history;
create policy "pronostic_history_update_all" on public.pronostic_history for update using (true);
drop policy if exists "pronostic_history_delete_all" on public.pronostic_history;
create policy "pronostic_history_delete_all" on public.pronostic_history for delete using (true);
create index if not exists pronostic_history_status_idx
  on public.pronostic_history (status, match_date desc);
create index if not exists pronostic_history_sport_status_idx
  on public.pronostic_history (sport, status, match_date desc);

-- ============================================================================
-- combo_history — bilan GLOBAL des combinés "Combiné Vision" (voir
-- lib/comboHistory.js). Même principe que pronostic_history : policies ouvertes,
-- aucune donnée personnelle.
-- ============================================================================
create table if not exists public.combo_history (
  id uuid primary key default gen_random_uuid(),
  combo_id text not null unique,
  risk_level text not null check (risk_level in ('faible', 'moyen', 'eleve')),
  is_live boolean not null default false,
  legs jsonb not null,
  confidence numeric,
  match_date timestamptz,
  saved_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'success', 'failure')),
  verified_at timestamptz
);
alter table public.combo_history enable row level security;
drop policy if exists "combo_history_select_all" on public.combo_history;
create policy "combo_history_select_all" on public.combo_history for select using (true);
drop policy if exists "combo_history_insert_all" on public.combo_history;
create policy "combo_history_insert_all" on public.combo_history for insert with check (true);
drop policy if exists "combo_history_update_all" on public.combo_history;
create policy "combo_history_update_all" on public.combo_history for update using (true);
drop policy if exists "combo_history_delete_all" on public.combo_history;
create policy "combo_history_delete_all" on public.combo_history for delete using (true);
create index if not exists combo_history_status_idx
  on public.combo_history (status, risk_level);
create index if not exists combo_history_match_date_idx
  on public.combo_history (match_date);

-- ============================================================================
-- team_stat_profiles — profil statistique réel par équipe (voir
-- lib/teamStatProfiles.js, lib/teamQualityRatings.js). Données GLOBALES, RLS
-- activée SANS policy (accès service role uniquement).
-- ============================================================================
create table if not exists public.team_stat_profiles (
  id bigint generated always as identity primary key,
  team_key text not null unique,
  team_name text not null,
  api_football_team_id text,
  competition_code text,
  competition_name text,
  matches_used integer not null default 0,
  sample_fixture_ids jsonb not null default '[]'::jsonb,
  overall jsonb not null,
  home jsonb not null,
  away jsonb not null,
  first_half jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.team_stat_profiles add column if not exists match_weights jsonb not null default '[]'::jsonb;
alter table public.team_stat_profiles add column if not exists quality_ratings jsonb;
alter table public.team_stat_profiles enable row level security;
create index if not exists team_stat_profiles_competition_idx
  on public.team_stat_profiles (competition_code);
create index if not exists team_stat_profiles_computed_at_idx
  on public.team_stat_profiles (computed_at);

-- ============================================================================
-- api_football_cache — cache PERSISTANT partagé par tous les sports (voir
-- lib/apiSportsCache.js) : une instance serverless froide réutilise la dernière
-- réponse encore fraîche plutôt que de rappeler l'API. Nom historique (football,
-- premier sport à en avoir eu besoin), schéma générique réutilisé tel quel par le
-- basket (clés préfixées "basketball:...").
-- ============================================================================
create table if not exists public.api_football_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.api_football_cache enable row level security;

-- ============================================================================
-- api_quota_usage — suivi du quota API-SPORTS, INDÉPENDANT par sport (voir
-- lib/apiQuota.js) : alimente la page /admin ("Consommation API du jour, par sport").
-- ============================================================================
create table if not exists public.api_quota_usage (
  sport text not null,
  day text not null, -- "YYYY-MM-DD" en UTC
  requests_used integer not null default 0,
  requests_remaining integer,
  requests_limit integer,
  updated_at timestamptz not null default now(),
  primary key (sport, day)
);
alter table public.api_quota_usage enable row level security;

notify pgrst, 'reload schema';

-- Vérification finale : une ligne par colonne réelle de chaque table listée
-- ci-dessus, plus une ligne par policy existante (attendu : des policies UNIQUEMENT
-- sur pronostic_history et combo_history, 4 chacune ; zéro policy sur les 7 autres
-- tables). Structure plate (UNION ALL, aucune sous-requête imbriquée) pour rester
-- robuste à un copier-coller mobile.
select 'column' as kind, table_name as name, column_name as detail1, data_type as detail2
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles', 'search_history', 'favorites', 'match_history',
    'pronostic_history', 'combo_history', 'team_stat_profiles',
    'api_football_cache', 'api_quota_usage'
  )
union all
select 'policy' as kind, tablename as name, policyname as detail1, null as detail2
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'search_history', 'favorites', 'match_history',
    'pronostic_history', 'combo_history', 'team_stat_profiles',
    'api_football_cache', 'api_quota_usage'
  )
order by kind, name;
