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
//
// "Continuer avec Google" (pages/connexion.js) redirige vers "/" (redirectTo) après
// le passage par Google — si Google/Supabase échoue en chemin (provider Google pas
// encore activé côté Supabase, redirect URI non autorisée, personne qui annule sur
// l'écran Google...), Supabase renvoie quand même vers "/" mais avec un
// "?error=...&error_description=..." dans l'URL au lieu d'une vraie session. Sans
// prise en charge explicite, la personne atterrissait sur cette page (protégée, donc
// vide tant qu'aucune session n'existe) avec ce message d'erreur brut resté dans
// l'URL, jamais traduit ni affiché nulle part — d'où l'impression d'un "écran vide
// avec une erreur". On détecte ce cas ici (le point de passage commun à toutes les
// pages protégées) et on renvoie vers /connexion avec l'erreur, pour qu'elle y soit
// affichée clairement (voir pages/connexion.js, lecture de "?authError=").
function extractOAuthError() {
  if (typeof window === "undefined") return null;
  const fromQuery = new URLSearchParams(window.location.search);
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = fromQuery.get("error_code") || fromHash.get("error_code") || fromQuery.get("error") || fromHash.get("error");
  const description = fromQuery.get("error_description") || fromHash.get("error_description");
  if (!code && !description) return null;
  return { code: code || "", message: description || code || "" };
}

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
    if (!sessionChecked || session) return;
    const oauthError = extractOAuthError();
    if (oauthError) {
      router.replace(`/connexion?authError=${encodeURIComponent(oauthError.code)}&authErrorDescription=${encodeURIComponent(oauthError.message)}`);
    } else {
      router.replace("/connexion");
    }
  }, [sessionChecked, session, router]);

  return { session, sessionChecked, authorized: Boolean(session) };
}
