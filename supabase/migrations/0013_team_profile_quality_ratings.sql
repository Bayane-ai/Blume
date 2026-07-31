-- PROMPT 1 (moteur d'évaluation de la qualité des équipes) : étend
-- team_stat_profiles (supabase/migrations/0011_team_stat_profiles.sql) avec :
--   - match_weights : le détail des poids récence×adversité réellement appliqués à
--     chaque match de l'échantillon (transparence — voir lib/teamStatProfiles.js),
--   - quality_ratings : les notes de qualité 0-100 par secteur (attaque, défense,
--     discipline, rythme) + une note globale, calculées par percentile RÉEL parmi les
--     autres équipes déjà profilées de la même compétition (voir
--     lib/teamQualityRatings.js) — jamais une échelle absolue arbitraire.
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

alter table team_stat_profiles
  add column if not exists match_weights jsonb not null default '[]'::jsonb,
  add column if not exists quality_ratings jsonb;

comment on column team_stat_profiles.quality_ratings is
  'Notes 0-100 par secteur (attack/defense/discipline/tempo/overall), par percentile réel parmi les autres équipes de la même compétition — null tant que trop peu d''équipes de cette compétition sont profilées (voir lib/teamQualityRatings.js, MIN_PEERS_FOR_RATING).';
