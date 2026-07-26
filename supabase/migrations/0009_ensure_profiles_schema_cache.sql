-- Non destructif, idempotent : garantit que public.profiles porte bien les 4
-- colonnes utilisées par pages/api/auth/login.js (id, email, created_at,
-- last_login_at — voir migration 0008_custom_auth.sql, qui les déclare déjà) ET
-- force PostgREST à recharger IMMÉDIATEMENT son cache de schéma.
--
-- Contexte : l'erreur "Could not find the 'last_login_at' column of 'profiles' in
-- the schema cache" ne signifie pas forcément que la colonne n'existe pas en base —
-- PostgREST maintient son propre cache du schéma et ne le rafraîchit pas toujours
-- immédiatement après un ALTER TABLE / une migration exécutée manuellement dans le
-- SQL Editor. `notify pgrst, 'reload schema'` force ce rafraîchissement sans attendre
-- le cycle automatique. À exécuter à chaque fois que ce message réapparaît, même si
-- les colonnes semblent déjà correctes.

alter table public.profiles add column if not exists id uuid primary key default gen_random_uuid();
alter table public.profiles add column if not exists email text unique not null;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists last_login_at timestamptz;

notify pgrst, 'reload schema';
