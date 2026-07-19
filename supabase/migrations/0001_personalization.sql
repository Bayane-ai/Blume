-- Historique de recherche et favoris, personnels à chaque compte.
-- Row Level Security garantit que chaque personne ne voit et ne modifie QUE ses
-- propres lignes (auth.uid() = user_id) : aucune donnée n'est partagée entre comptes.
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

create table if not exists search_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now()
);

alter table search_history enable row level security;

create policy "search_history_select_own"
  on search_history for select
  using (auth.uid() = user_id);

create policy "search_history_insert_own"
  on search_history for insert
  with check (auth.uid() = user_id);

create policy "search_history_delete_own"
  on search_history for delete
  using (auth.uid() = user_id);

create index if not exists search_history_user_created_idx
  on search_history (user_id, created_at desc);

create table if not exists favorites (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('competition', 'team')),
  ref_id text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref_id)
);

alter table favorites enable row level security;

create policy "favorites_select_own"
  on favorites for select
  using (auth.uid() = user_id);

create policy "favorites_insert_own"
  on favorites for insert
  with check (auth.uid() = user_id);

create policy "favorites_delete_own"
  on favorites for delete
  using (auth.uid() = user_id);
