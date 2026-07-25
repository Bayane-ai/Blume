import { useEffect, useState } from "react";
import { useRouter } from "next/router";

// Bloc 3 (comptes) : la première page vue par une personne non connectée doit être la
// page de connexion (/connexion) — dès que l'absence de session est confirmée, ce
// hook redirige lui-même vers /connexion. Les pages qui l'utilisent gardent leur
// structure habituelle ("if (!sessionChecked) Chargement… ; if (!authorized) return
// null") : renvoyer `null` pendant la redirection évite d'afficher un instant les
// données protégées avant que le navigateur ne quitte effectivement la page.
//
// Le cookie de session est httpOnly (voir lib/session.js) — illisible depuis ce code,
// qui tourne dans le navigateur : la seule façon de savoir "est-ce que je suis
// connecté ?" est de le demander au serveur (voir pages/api/auth/session.js), plutôt
// que d'appeler un SDK d'authentification côté client (il n'y en a plus, Supabase
// Auth a été entièrement abandonné).
export function useRequireAuth() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setSession(data?.session || null);
        setSessionChecked(true);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setSessionChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (sessionChecked && !session) {
      router.replace("/connexion");
    }
  }, [sessionChecked, session, router]);

  return { session, sessionChecked, authorized: Boolean(session) };
}
