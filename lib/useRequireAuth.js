import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

// La création de compte posait problème (inscription refusée) et bloquait l'accès à
// l'application — la connexion est donc temporairement OPTIONNELLE : on ne redirige
// plus vers /login, `authorized` reste vrai dès que la session a été vérifiée, avec
// ou sans compte connecté. Si un compte est bien connecté, la personnalisation
// (historique de recherche, favoris) continue de fonctionner normalement.
export function useRequireAuth() {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { session, sessionChecked, authorized: sessionChecked };
}
