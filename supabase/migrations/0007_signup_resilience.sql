-- Corrige un bug bloquant à l'inscription : la fonction handle_new_user() (voir
-- 0005_profiles.sql) insère dans "profiles" DANS LA MÊME TRANSACTION que la création
-- du compte dans auth.users. "nom_utilisateur" y est UNIQUE : si deux comptes
-- choisissent le même pseudo (ou tout autre souci d'écriture dans "profiles" — colonne
-- manquante après une migration mal appliquée, etc.), l'INSERT dans "profiles" échoue,
-- ce qui annule TOUTE la transaction — le compte auth.users n'est alors jamais créé.
-- Supabase Auth renvoie dans ce cas une erreur générique HTTP 500
-- ("Database error saving new user", error_code "unexpected_failure") : c'est
-- exactement l'erreur reproduite et corrigée côté application dans lib/authErrors.js
-- (qui, à cause d'un comportement de supabase-js, affichait encore pire : "{}",
-- littéralement illisible).
--
-- La ligne "profiles" est un CONFORT (pseudo affiché, historique personnalisé) : elle
-- ne doit jamais pouvoir empêcher la création du compte lui-même. On rend donc le
-- trigger résilient : une violation d'unicité sur le pseudo retente SANS pseudo
-- (l'app affiche alors l'email à la place, voir components/SiteHeader.js :
-- "pseudo || session?.user?.email") plutôt que d'annuler l'inscription ; toute AUTRE
-- erreur imprévue est journalisée (RAISE WARNING, visible dans les logs Supabase) et
-- avalée plutôt que de bloquer le compte.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (id, email, nom_utilisateur, date_de_naissance)
    values (
      new.id,
      new.email,
      new.raw_user_meta_data ->> 'nom_utilisateur',
      nullif(new.raw_user_meta_data ->> 'date_de_naissance', '')::date
    )
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- Le pseudo est déjà pris (cas le plus probable) : le compte se crée quand
      -- même, simplement sans pseudo pour l'instant.
      insert into public.profiles (id, email, nom_utilisateur, date_de_naissance)
      values (
        new.id,
        new.email,
        null,
        nullif(new.raw_user_meta_data ->> 'date_de_naissance', '')::date
      )
      on conflict (id) do nothing;
    when others then
      raise warning 'handle_new_user: échec insertion profiles pour %, compte créé quand même : %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- Permet à l'application de vérifier la disponibilité d'un pseudo AVANT d'appeler
-- signUp (voir pages/inscription.js) : évite de déclencher la violation d'unicité
-- ci-dessus dans le cas le plus courant, avec un message clair ("Ce pseudo est déjà
-- utilisé") plutôt que de compter uniquement sur la résilience du trigger.
-- "security definer" est nécessaire : la Row Level Security de "profiles"
-- (profiles_select_own) empêche normalement de lire la ligne d'un AUTRE compte — cette
-- fonction ne renvoie qu'un booléen, jamais une donnée de la ligne trouvée.
create or replace function public.pseudo_is_taken(p_pseudo text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where nom_utilisateur = p_pseudo
  );
$$;

grant execute on function public.pseudo_is_taken(text) to anon, authenticated;
