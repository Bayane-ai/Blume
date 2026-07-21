-- Bloc 3 (parcours vidéo) : nouvelle règle de classement du badge global Succès/Échec
-- ("nouvelle IA, l'historique démarre à zéro maintenant") — seule l'équipe favorite
-- désignée avant le match compte désormais (voir lib/pronosticHistory.js,
-- classifyOutcome), le Total de buts ne fait plus basculer le verdict global comme
-- avant. Les entrées déjà enregistrées ont été classées sous l'ANCIENNE règle
-- (issue + Total de buts) : elles ne sont plus comparables à celles classées
-- désormais, d'où cette remise à zéro complète et volontaire de l'historique.
-- À exécuter UNE SEULE FOIS dans Supabase (Dashboard -> SQL Editor -> New query ->
-- Run) — seules les analyses effectuées à partir de maintenant réalimenteront les
-- pages "Probabilités réussies" / "Probabilités échouées".

truncate table pronostic_history;
