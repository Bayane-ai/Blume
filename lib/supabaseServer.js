import { createServerClient } from '@supabase/ssr';
import { stringifySetCookie } from 'cookie';

// Client Supabase SERVEUR (Pages Router : routes API `pages/api/*.js` et
// `getServerSideProps`) — pour un futur code qui doit reconnaître la personne
// connectée côté serveur (ex. Bloc 4 : protection des pages). Utilise UNIQUEMENT la
// clé publique anon (la même que lib/supabaseClient.js) : aucune clé secrète ici. La
// sécurité vient de la Row Level Security (voir supabase/migrations) appliquée avec
// l'identité RÉELLE de la personne, lue depuis les cookies de SA requête — jamais un
// accès élevé au nom de tout le monde.
//
// Un nouveau client à chaque appel (jamais partagé ni mis en cache entre requêtes,
// comme recommandé par @supabase/ssr) : deux requêtes HTTP différentes peuvent venir
// de deux personnes différentes.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

export function createSupabaseServerClient(req, res) {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        const existing = res.getHeader("Set-Cookie");
        const existingCookies = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
        const newCookies = cookiesToSet.map(({ name, value, options }) => stringifySetCookie(name, value, options));
        res.setHeader("Set-Cookie", [...existingCookies, ...newCookies]);
      },
    },
  });
}
