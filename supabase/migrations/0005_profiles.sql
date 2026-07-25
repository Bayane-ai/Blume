-- Système de comptes (Bloc 1) : une ligne "profiles" par utilisateur, créée
-- AUTOMATIQUEMENT à l'inscription (trigger ci-dessous sur auth.users) — jamais créée
-- à la main par l'application. Row Level Security : chaque personne ne peut lire/
-- modifier QUE sa propre ligne (auth.uid() = id) ; aucune policy d'insertion ou de
-- suppression directe (la ligne est écrite par le trigger security definer, et
-- supprimée automatiquement via "on delete cascade" quand le compte auth.users
-- disparaît) : personne ne peut créer/supprimer une ligne "profiles" au nom d'un
-- autre compte, ni la sienne en dehors du parcours d'inscription normal.
-- À exécuter une fois dans Supabase (Dashboard -> SQL Editor -> New query -> Run).

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  date_de_naissance date,
  nom_utilisateur text unique,
  date_de_creation timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Crée automatiquement la ligne "profiles" au moment de l'inscription. nom_utilisateur
-- et date_de_naissance viennent des métadonnées passées à
-- supabase.auth.signUp({ options: { data: {...} } }) par la page d'inscription (Bloc 2,
-- pas encore créée à ce stade) : NULL tant qu'elles ne sont pas fournies, jamais une
-- valeur inventée. "security definer" contourne volontairement la RLS ci-dessus, car
-- la personne n'a pas encore de session au moment exact de l'insertion ; "set
-- search_path = public" évite qu'un rôle malveillant ne détourne la fonction en
-- redéfinissant un schéma prioritaire dans son propre search_path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nom_utilisateur, date_de_naissance)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'nom_utilisateur',
    nullif(new.raw_user_meta_data ->> 'date_de_naissance', '')::date
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
