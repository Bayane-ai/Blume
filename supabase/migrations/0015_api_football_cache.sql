-- Cache PERSISTANT (partagé entre toutes les instances serverless) pour lib/
-- apiFootball.js — signalement réel (championnats russe, écossais, néerlandais,
-- norvégien absents malgré API_FOOTBALL_KEY correctement configurée en production) :
-- le cache en mémoire de ce fichier (Map/variable de module) ne survit QUE le temps
-- d'une instance Vercel "chaude" — sous trafic réel, chaque instance froide repart de
-- zéro et refait TOUS les appels API-Football depuis le début (jusqu'à 9 appels par
-- chargement de "Matchs à venir", un par jour de la fenêtre), ce qui épuise le quota
-- gratuit (100 requêtes/jour) en quelques chargements de page — après quoi TOUTE
-- compétition qui dépend uniquement d'API-Football (donc absente des 12 grandes
-- ligues de lib/competitions.js : Russie, Écosse, Norvège, Supercoupes...) disparaît
-- silencieusement jusqu'au renouvellement du quota le lendemain. Cette table permet à
-- une instance froide de réutiliser la dernière réponse encore fraîche plutôt que de
-- rappeler l'API à chaque fois, et à la pause anti-quota (429) d'être respectée par
-- TOUTES les instances plutôt que par la seule qui a reçu le 429.
-- Données GLOBALES (pas personnelles à un compte) : accès exclusivement via le service
-- role (lib/supabaseAdmin.js), même principe que team_stat_profiles (voir
-- supabase/migrations/0011_team_stat_profiles.sql).
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

create table if not exists api_football_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table api_football_cache enable row level security;
-- Aucune policy créée ici, intentionnellement : ni lecture ni écriture via la clé
-- anonyme, uniquement via le service role (bypass RLS) depuis les routes API serveur.
