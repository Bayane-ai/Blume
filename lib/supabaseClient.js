import { createBrowserClient } from '@supabase/ssr';

// Client Supabase NAVIGATEUR (composants React : pages/connexion.js, lib/useRequireAuth.js,
// components/SiteHeader.js, lib/personalization.js — jamais une route API, voir
// lib/supabaseAnon.js pour ça). Utilise @supabase/ssr plutôt que le createClient() brut
// de @supabase/supabase-js : la session est stockée dans des COOKIES (pas seulement le
// localStorage), lisibles aussi côté serveur via lib/supabaseServer.js — nécessaire
// pour qu'une future page protégée en SSR (Bloc 4) puisse reconnaître la personne
// connectée dès le premier rendu serveur, sans attendre l'hydratation.
//
// Une barre oblique finale ou un espace superflu dans NEXT_PUBLIC_SUPABASE_URL (ex :
// copié-collé depuis le dashboard Supabase) produit des requêtes vers un chemin
// mal formé ("https://xxx.supabase.co//auth/v1/signup") — Supabase répond alors
// "Invalid path specified in request URL", un message qui n'a rien à voir avec le
// formulaire lui-même. On normalise l'URL pour éviter cette classe de bug.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

// Si ces variables manquent (ex. définies en Preview/Development sur Vercel mais pas
// en Production, ou ajoutées APRÈS le dernier build — NEXT_PUBLIC_* sont figées dans
// le bundle au moment du build, jamais relues au runtime : ajouter la variable sur
// Vercel sans redéployer ensuite ne change rien tant que le build n'a pas été refait),
// createBrowserClient() lève une exception IMMÉDIATE, à l'import du module : comme ce
// fichier est importé par toutes les pages qui touchent à l'authentification
// (connexion, accueil...), ça plantait TOUT le site avec l'écran d'erreur générique de
// Next.js, sans aucun indice sur la cause réelle. On avale cette erreur ici et on
// expose à la place un client qui échoue proprement, AVANT même de tenter le moindre
// appel réseau vers Supabase (voir `fail` ci-dessous : aucun fetch n'est fait), avec un
// message diagnostiquable qui dit EXACTEMENT quelle(s) variable(s) manquent (console +
// erreur affichée telle quelle par friendlyAuthError, voir lib/authErrors.js), plutôt
// qu'un crash muet ou un message vague.
const missingVars = [];
if (!supabaseUrl) missingVars.push("NEXT_PUBLIC_SUPABASE_URL");
if (!supabaseAnonKey) missingVars.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const MISSING_CONFIG_MESSAGE =
  `Configuration Supabase manquante : ${missingVars.join(" et ")} ${missingVars.length > 1 ? "sont vides" : "est vide"} dans ce déploiement. ` +
  "Vérifie les variables d'environnement sur Vercel (Settings -> Environment Variables), qu'elles sont cochées pour l'environnement Production, " +
  "et REDÉPLOIE ensuite (Deployments -> ... -> Redeploy) : NEXT_PUBLIC_* sont figées dans le build, les ajouter seules ne suffit pas.";
const MISSING_CONFIG_ERROR = { name: "AuthMissingConfigError", code: "missing_config", message: MISSING_CONFIG_MESSAGE, status: 500 };

function createBrokenClientStub() {
  console.error(MISSING_CONFIG_MESSAGE);
  const fail = async () => ({ data: null, error: MISSING_CONFIG_ERROR });
  return {
    auth: {
      signInWithOtp: fail,
      verifyOtp: fail,
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: fail, order: fail }) }) }),
    rpc: fail,
  };
}

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createBrowserClient(supabaseUrl, supabaseAnonKey)
  : createBrokenClientStub();
