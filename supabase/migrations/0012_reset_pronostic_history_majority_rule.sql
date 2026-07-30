-- Correction du bug "Probabilités réussies/échouées vides" : le classement Succès/
-- Échec d'un match ne juge plus SEULEMENT l'issue du match (voir supabase/migrations/
-- 0003_reset_pronostic_history.sql pour la règle précédente) mais la MAJORITÉ de
-- TOUTES ses lignes de pronostic (issue du match, scores exacts, totaux, corners,
-- hors-jeu, fautes, tirs, tirs cadrés, cartons) — voir lib/pronosticHistory.js,
-- classifyByMajority. Les entrées déjà enregistrées ont été classées sous l'ANCIENNE
-- règle : elles ne sont plus comparables à celles classées désormais, d'où cette
-- remise à zéro complète et volontaire de l'historique (même raison que 0003).
-- À exécuter UNE SEULE FOIS dans Supabase (Dashboard -> SQL Editor -> New query ->
-- Run) — le règlement automatique de fin de match (balayage opportuniste sur le
-- trafic normal du site + route cron dédiée, voir pages/api/cron/
-- settle-predictions.js) réalimentera les deux pages sans action manuelle dès que des
-- matchs analysés se termineront.

truncate table pronostic_history;
