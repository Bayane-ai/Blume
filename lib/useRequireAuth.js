import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "./supabaseClient";

// Bloc 3 (comptes) : la première page vue par une personne non connectée doit être la
// page de connexion (/connexion) — l'accès anonyme était temporairement toléré tant
// que l'inscription/la connexion n'étaient pas encore fiables (Blocs 1-2), ce n'est
// plus le cas. `authorized` ne vaut donc vrai qu'avec une VRAIE session ; dès que
// l'absence de session est confirmée, ce hook redirige lui-même vers /connexion. Les
// pages qui l'utilisent gardent leur structure habituelle ("if (!sessionChecked)
// Chargement… ; if (!authorized) return null") : renvoyer `null` pendant la
// redirection évite d'afficher un instant les données protégées avant que le
// navigateur ne quitte effectivement la page.
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
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (sessionChecked && !session) {
      router.replace("/connexion");
    }
  }, [sessionChecked, session, router]);

  return { session, sessionChecked, authorized: Boolean(session) };
}
