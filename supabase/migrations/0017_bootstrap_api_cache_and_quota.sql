-- Bloc unique, rejouable sans erreur (CREATE TABLE IF NOT EXISTS partout, aucune
-- policy créée donc rien à DROP POLICY IF EXISTS avant) — regroupe les deux
-- migrations encore jamais exécutées en production (0015_api_football_cache.sql,
-- 0016_api_quota_usage.sql), pour n'avoir qu'un seul copier-coller à faire dans le
-- SQL Editor Supabase (Dashboard -> SQL Editor -> New query -> Run).
--
-- api_football_cache : cache PERSISTANT partagé par tous les sports (voir
-- lib/apiSportsCache.js) — une instance serverless froide (Vercel) réutilise la
-- dernière réponse encore fraîche plutôt que de rappeler l'API, protège la pause
-- anti-quota entre toutes les instances. Nom historique (football, premier sport à
-- en avoir eu besoin) mais schéma déjà générique, réutilisé tel quel par le basket
-- (clés préfixées "basketball:...").
--
-- api_quota_usage : suivi du quota API-SPORTS, INDÉPENDANT par sport (voir
-- lib/apiQuota.js) — lit x-ratelimit-requests-remaining/-limit sur chaque appel réel,
-- alimente la page /admin ("Consommation API du jour, par sport").
--
-- Données GLOBALES (pas personnelles à un compte) : RLS activée SANS policy sur les
-- deux tables, donc accessibles UNIQUEMENT via le service role (bypass RLS) depuis
-- les routes API serveur — jamais via la clé anonyme, même principe que
-- team_stat_profiles (voir supabase/migrations/0011_team_stat_profiles.sql).

create table if not exists api_football_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table api_football_cache enable row level security;

create table if not exists api_quota_usage (
  sport text not null,
  day text not null, -- "YYYY-MM-DD" en UTC
  requests_used integer not null default 0,
  requests_remaining integer,
  requests_limit integer,
  updated_at timestamptz not null default now(),
  primary key (sport, day)
);
alter table api_quota_usage enable row level security;

-- Vérification : parenthèses volontairement réduites au minimum (une seule requête,
-- structure plate, sans sous-requête imbriquée) — une précédente version plus riche
-- (jsonb_agg/jsonb_build_object) a déclenché une erreur de syntaxe après un
-- copier-coller mobile, l'éditeur ayant fermé des parenthèses en double pendant le
-- collage. Une ligne par colonne réelle des deux tables, plus une ligne par policy
-- (aucune attendue pour les deux — confirme qu'aucun accès n'est ouvert à la clé
-- anonyme), le tout dans un seul résultat via UNION ALL.
select 'column' as kind, table_name as name, column_name as detail1, data_type as detail2
from information_schema.columns
where table_schema = 'public' and table_name in ('api_football_cache', 'api_quota_usage')
union all
select 'policy' as kind, tablename as name, policyname as detail1, null as detail2
from pg_policies
where schemaname = 'public' and tablename in ('api_football_cache', 'api_quota_usage')
order by kind, name;
