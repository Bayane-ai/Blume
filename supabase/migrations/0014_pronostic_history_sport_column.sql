-- Bloc 4 (multi-sport, basket) — lib/sports/basketball/pronosticHistory.js réutilise
-- la MÊME table pronostic_history que le football (voir 0002_pronostic_history.sql),
-- déjà conçue pour n'importe quel match_id (le préfixe "bk-" des ids basket, voir
-- lib/sports/basketball/mapper.js, empêche déjà toute collision avec les ids
-- football). Cette colonne "sport" sert UNIQUEMENT à ce que les pages "Probabilités
-- réussies/échouées" de chaque onglet (Football/Basket) ne mélangent jamais leurs
-- listes — jamais utilisée pour retrouver une ligne précise (match_id reste unique et
-- suffisant pour ça, voir getFrozenPrediction/verifyFrozenPrediction).
--
-- Le comptage basket démarre à zéro (PROMPT bloc 4, point 5) : aucune ligne existante
-- ne porte encore de match_id "bk-...", donc rien à corriger sur les lignes déjà
-- présentes — elles restent toutes 'football' via la valeur par défaut ci-dessous, pas
-- besoin d'un TRUNCATE comme 0003/0012 (qui remettaient à zéro une règle de
-- classement déjà appliquée à des données existantes).
--
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

alter table public.pronostic_history add column if not exists sport text not null default 'football';

create index if not exists pronostic_history_sport_status_idx
  on public.pronostic_history (sport, status, match_date desc);
