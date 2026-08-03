-- Suivi du quota API-SPORTS, INDÉPENDANT par sport (football, basketball, et tout
-- sport ajouté plus tard) — voir lib/apiQuota.js. Chaque ligne représente UN sport
-- pour UN jour (UTC) : le nombre d'appels réellement effectués aujourd'hui
-- (requests_used, incrémenté par ce code), et la dernière valeur connue de
-- x-ratelimit-requests-remaining/-limit renvoyée par l'API elle-même (jamais déduite,
-- toujours lue depuis l'en-tête réel de la dernière réponse). Sert la page
-- d'administration (pages/admin/quota.js) ET la décision "arrêter d'appeler l'API
-- avant même le prochain 429" dès que le quota du jour est confirmé épuisé.
-- Données GLOBALES (pas personnelles à un compte) : accès exclusivement via le
-- service role, même principe que team_stat_profiles et api_football_cache.
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

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
-- Aucune policy créée ici, intentionnellement : ni lecture ni écriture via la clé
-- anonyme, uniquement via le service role (bypass RLS) depuis les routes API serveur.
