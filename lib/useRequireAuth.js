import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "./supabaseClient";

// Chaque visiteur doit créer un compte (email + mot de passe) et se connecter avant
// d'accéder à l'application : les identifiants et la session de chacun sont gérés par
// Supabase Auth, isolés par compte (aucun partage de données entre deux comptes
// différents). Tant que la session n'est pas vérifiée, ou si personne n'est connecté,
// le contenu de la page ne doit pas s'afficher.
export function useRequireAuth() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionChecked(true);
      if (!data.session) router.replace("/login");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) router.replace("/login");
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { session, sessionChecked, authorized: sessionChecked && !!session };
}
