-- Non destructif, idempotent : réaffirme explicitement la posture de sécurité des
-- tables PERSONNELLES (profiles, search_history, favorites, match_history) — voir
-- supabase/migrations/0008_custom_auth.sql, qui l'a déjà mise en place. Ce fichier
-- ne fait qu'EN CONFIRMER l'état, sans rien changer si tout est déjà correct : sûr à
-- exécuter autant de fois que nécessaire.
--
-- IMPORTANT — pourquoi il n'y a AUCUNE policy "auth.uid() = user_id" ici :
-- ce projet n'utilise plus du tout Supabase Auth (voir PROMPT, "connexion sans mot
-- de passe, sans email de vérification, sans code" — un cookie signé maison,
-- vérifié uniquement dans le code Node du serveur, jamais par Postgres). Il n'existe
-- donc AUCUNE session Postgres "authenticated" avec un auth.uid() à comparer : toute
-- policy de ce type serait TOUJOURS fausse (aucune ligne ne remonterait jamais), ou
-- pire, une erreur de policy mal écrite pourrait accidentellement tout ouvrir.
--
-- La vraie protection ici : RLS activée + AUCUNE policy du tout sur ces 4 tables.
-- Résultat : la clé "anon" (celle qu'un navigateur pourrait présenter) ne voit et
-- n'écrit STRICTEMENT RIEN sur ces tables, quoi qu'il arrive. Seule la clé
-- "service_role" (qui contourne RLS par construction, réservée au code serveur —
-- voir lib/supabaseAdmin.js, jamais importée par du code navigateur) peut y accéder,
-- et c'est ce code serveur qui filtre TOUJOURS par l'utilisateur de la session en
-- cours (voir pages/api/match-history.js, search-history.js, favorites.js :
-- `session.id`, jamais un paramètre fourni par le client). C'est une isolation plus
-- stricte qu'une policy par ligne : même une policy mal écrite ne peut pas fuiter,
-- puisqu'il n'y a simplement aucun chemin d'accès direct depuis le navigateur.

alter table public.profiles enable row level security;
alter table public.search_history enable row level security;
alter table public.favorites enable row level security;
alter table public.match_history enable row level security;

-- Filet de sécurité : au cas où une policy aurait été ajoutée manuellement depuis
-- (dans le dashboard Supabase, par exemple) sans passer par une migration, on la
-- retire explicitement ici — ces 4 tables doivent rester à zéro policy.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "search_history_select_own" on public.search_history;
drop policy if exists "search_history_insert_own" on public.search_history;
drop policy if exists "search_history_delete_own" on public.search_history;
drop policy if exists "favorites_select_own" on public.favorites;
drop policy if exists "favorites_insert_own" on public.favorites;
drop policy if exists "favorites_delete_own" on public.favorites;
drop policy if exists "match_history_select_own" on public.match_history;
drop policy if exists "match_history_insert_own" on public.match_history;
drop policy if exists "match_history_update_own" on public.match_history;
drop policy if exists "match_history_delete_own" on public.match_history;

-- Vérification à la main (à lancer séparément si tu veux inspecter l'état réel) :
--
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public'
--     and tablename in ('profiles','search_history','favorites','match_history');
-- -- rowsecurity doit valoir "true" pour les 4 lignes.
--
-- select schemaname, tablename, policyname from pg_policies
--   where schemaname = 'public'
--     and tablename in ('profiles','search_history','favorites','match_history');
-- -- ne doit renvoyer AUCUNE ligne.
--
-- select indexname, indexdef from pg_indexes
--   where schemaname = 'public'
--     and tablename in ('search_history','favorites','match_history');
-- -- confirme l'index sur profile_id pour chaque table (search_history_profile_created_idx,
-- -- match_history_profile_added_idx, et l'index implicite de la contrainte unique
-- -- favorites_profile_kind_ref_id_key, dont profile_id est la colonne de tête).

notify pgrst, 'reload schema';
