-- Bloc 1 (profils statistiques par équipe) : les stats affichées (corners, tirs,
-- fautes, cartons...) étaient jusqu'ici une estimation dérivée d'une MÊME moyenne de
-- championnat pour toutes les équipes (voir lib/pronostic.js, AVG_CORNERS_TOTAL etc.)
-- — d'où des chiffres quasi identiques d'un match et d'une équipe à l'autre. Cette
-- table stocke pour CHAQUE équipe un vrai profil calculé à partir de ses derniers
-- matchs réellement joués (API-Football, /fixtures + /fixtures/statistics), avec une
-- répartition domicile/extérieur — jamais une constante partagée entre équipes (voir
-- lib/teamStatProfiles.js). Données GLOBALES (pas personnelles à un compte) : accès
-- exclusivement via le service role (lib/supabaseAdmin.js) depuis les routes API
-- serveur, jamais depuis le navigateur — RLS activée SANS policy, donc aucun accès via
-- la clé anonyme (même principe que les tables personnelles depuis
-- supabase/migrations/0008_custom_auth.sql).
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

create table if not exists team_stat_profiles (
  id bigint generated always as identity primary key,
  -- Nom d'équipe normalisé (lib/apiFootball.js#normalizeTeamName) : clé stable entre
  -- football-data.org et API-Football, qui n'utilisent pas les mêmes identifiants.
  team_key text not null unique,
  team_name text not null,
  api_football_team_id text,
  -- Compétition du dernier calcul (best-effort, sert de repli "moyenne de la
  -- compétition" pour une équipe dont une statistique précise est totalement absente —
  -- voir lib/teamStatProfiles.js) : une équipe peut légitimement changer de
  -- compétition d'un calcul à l'autre.
  competition_code text,
  competition_name text,
  matches_used integer not null default 0,
  sample_fixture_ids jsonb not null default '[]'::jsonb,
  -- Chacun de ces trois blocs contient les mêmes clés de statistique (buts, corners,
  -- tirs, tirs cadrés, fautes, touches, hors-jeu, cartons), chacune sous la forme
  -- { value, estimated, sampleSize, available } — jamais une valeur nue qui masquerait
  -- si elle vient d'une vraie mesure ou d'un repli.
  overall jsonb not null,
  home jsonb not null,
  away jsonb not null,
  -- 1ère mi-temps (buts, corners, fautes, touches, hors-jeu) : structure prête, mais
  -- actuellement toujours "indisponible" (available: false) — aucune source connectée
  -- ne fournit de décompte réel par mi-temps, y compris après coup (voir
  -- lib/pronosticVerification.js, déjà établi ailleurs dans ce projet).
  first_half jsonb not null,
  computed_at timestamptz not null default now()
);

alter table team_stat_profiles enable row level security;
-- Aucune policy créée ici, intentionnellement : ni lecture ni écriture via la clé
-- anonyme, uniquement via le service role (bypass RLS) depuis les routes API serveur.

create index if not exists team_stat_profiles_competition_idx
  on team_stat_profiles (competition_code);

create index if not exists team_stat_profiles_computed_at_idx
  on team_stat_profiles (computed_at);
