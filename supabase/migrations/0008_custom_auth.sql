-- Remplace ENTIÈREMENT Supabase Auth (mot de passe, magic link, code par email,
-- Google OAuth — tout est abandonné) par un système propre à l'application : une
-- ligne "profiles" par email, une session signée par le SERVEUR (JWT HS256, voir
-- lib/session.js), jamais par Supabase Auth. La table auth.users n'est plus utilisée
-- du tout par ce projet à partir de maintenant (les routes API n'appellent plus
-- jamais supabase.auth.*).
--
-- ATTENTION, MIGRATION DESTRUCTIVE — à exécuter une seule fois dans Supabase
-- (Dashboard -> SQL Editor -> New query -> Run), en connaissance de cause :
--   - L'ancienne table "profiles" (supabase/migrations/0005_profiles.sql /
--     0007_signup_resilience.sql) référençait auth.users(id) et stockait un pseudo /
--     une date de naissance qui ne sont plus collectés depuis longtemps (aucun
--     formulaire ne les demande plus, voir l'historique de ce dépôt). Son schéma est
--     fondamentalement incompatible avec le nouveau (id auto-généré par la table
--     elle-même, sans aucun lien avec auth.users) : elle est supprimée et recréée.
--   - Les tables personnelles (search_history, favorites, match_history) étaient
--     protégées par des policies RLS "auth.uid() = user_id" : auth.uid() ne
--     résoudra plus jamais rien puisque Supabase Auth n'est plus utilisé — ces
--     policies ne protègent donc plus rien et sont supprimées. Les lignes
--     existantes, toutes rattachées à d'anciens comptes auth.users qui n'existeront
--     plus jamais (impossible de se reconnecter à ces comptes, Supabase Auth étant
--     abandonné), sont orphelines par construction : aucun nouveau profil ne peut
--     les réclamer (les espaces d'identifiants des deux systèmes n'ont aucun lien).
--     Elles sont donc VIDÉES (TRUNCATE) plutôt que laissées comme déchets
--     inaccessibles — c'est une conséquence acceptée et inévitable de l'abandon
--     complet de Supabase Auth, pas un oubli.
--   - pronostic_history et combo_history (bilan GLOBAL du site, PAS un contenu
--     personnel par compte — voir 0002/0004) restent entièrement inchangées.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.pseudo_is_taken(text);
drop table if exists profiles cascade;

create table profiles (
  id uuid primary key default gen_random_uuid(),
  -- Stockée en minuscules et sans espaces par l'application (voir
  -- pages/api/auth/login.js) avant tout insert/update : la contrainte unique porte
  -- donc bien sur l'email normalisé, jamais une variante de casse du même email.
  email text unique not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

alter table profiles enable row level security;
-- Aucune policy : la clé "anon" (celle du navigateur, si jamais réutilisée par
-- erreur) ne voit donc JAMAIS aucune ligne, quoi qu'il arrive. Seule la clé
-- "service_role" (qui contourne RLS, voir lib/supabaseAdmin.js — jamais importée par
-- du code navigateur) peut lire/écrire cette table, exclusivement depuis les routes
-- API du serveur (pages/api/auth/login.js et les routes de contenu personnel
-- ci-dessous).

-- Recherches récentes (voir supabase/migrations/0001_personalization.sql).
drop policy if exists "search_history_select_own" on search_history;
drop policy if exists "search_history_insert_own" on search_history;
drop policy if exists "search_history_delete_own" on search_history;
truncate table search_history;
alter table search_history drop column if exists user_id;
alter table search_history add column profile_id uuid not null references profiles(id) on delete cascade;
create index if not exists search_history_profile_created_idx on search_history (profile_id, created_at desc);

-- Compétitions favorites (même migration 0001).
drop policy if exists "favorites_select_own" on favorites;
drop policy if exists "favorites_insert_own" on favorites;
drop policy if exists "favorites_delete_own" on favorites;
truncate table favorites;
alter table favorites drop column if exists user_id;
alter table favorites add column profile_id uuid not null references profiles(id) on delete cascade;
alter table favorites add constraint favorites_profile_kind_ref_id_key unique (profile_id, kind, ref_id);

-- "Historique" des matchs consultés (supabase/migrations/0006_match_history.sql) —
-- le seul contenu personnel explicitement listé par le prompt, mais search_history/
-- favorites subissent exactement le même sort ci-dessus : leur RLS reposait sur le
-- même auth.uid() devenu inopérant, les laisser inchangées aurait rendu ces deux
-- fonctionnalités silencieusement cassées pour tout le monde.
drop policy if exists "match_history_select_own" on match_history;
drop policy if exists "match_history_insert_own" on match_history;
drop policy if exists "match_history_update_own" on match_history;
drop policy if exists "match_history_delete_own" on match_history;
truncate table match_history;
alter table match_history drop column if exists user_id;
alter table match_history add column profile_id uuid not null references profiles(id) on delete cascade;
alter table match_history add constraint match_history_profile_match_id_key unique (profile_id, match_id);
create index if not exists match_history_profile_added_idx on match_history (profile_id, added_at desc);

-- Les trois tables personnelles restent avec RLS activée mais SANS AUCUNE policy
-- (comme "profiles" ci-dessus) : défense en profondeur si jamais la clé anon était
-- un jour réutilisée par erreur contre ces tables — l'isolation entre comptes n'est
-- plus assurée par Postgres mais par le code serveur (pages/api/search-history.js,
-- pages/api/favorites.js, pages/api/match-history.js), qui filtre systématiquement
-- chaque requête par le profile_id de LA SESSION (voir lib/session.js#getSession),
-- jamais par un identifiant fourni par le client.
