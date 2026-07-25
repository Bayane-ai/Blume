import { createClient } from '@supabase/supabase-js';

// Client Supabase avec la clé SERVICE ROLE — contourne toute Row Level Security,
// réservé EXCLUSIVEMENT aux routes API (pages/api/**), jamais importé par un composant
// React ni exposé au navigateur (voir PROMPT, point 2 : "SUPABASE_SERVICE_ROLE_KEY
// server-only, SANS NEXT_PUBLIC_"). C'est la seule clé qui peut lire/écrire
// "profiles" et les tables personnelles (search_history, favorites, match_history),
// désormais sans policy publique (voir supabase/migrations/0008_custom_auth.sql) :
// l'isolation entre comptes n'est plus assurée par Postgres (RLS, basée sur
// auth.uid() qui n'existe plus sans Supabase Auth) mais par LE CODE de chaque route
// API, qui filtre systématiquement chaque requête par le profile_id de la session
// (voir lib/session.js#getSession) — jamais par un identifiant fourni par le client.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

let cachedClient = null;

// Fonction plutôt qu'un client construit au chargement du module : si la clé
// service_role manque (oubliée sur Vercel, ou pas encore redéployée après l'avoir
// ajoutée — NEXT_PUBLIC_SUPABASE_URL est public donc figée dans le build, mais
// SUPABASE_SERVICE_ROLE_KEY est lue au runtime serveur, à chaque requête), l'erreur
// n'est levée qu'au moment où une route l'utilise réellement — jamais un crash muet
// de toute l'application dès l'import de ce fichier. L'appelant (chaque route API)
// attrape cette erreur et renvoie un message clair, jamais "contactez
// l'administrateur" (voir PROMPT, point 7).
export function getSupabaseAdmin() {
  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [];
    if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    throw new Error(
      `Configuration serveur manquante : ${missing.join(" et ")} ${missing.length > 1 ? "sont vides" : "est vide"} dans ce déploiement. ` +
      "Vérifie les variables d'environnement sur Vercel (Production) et redéploie ensuite."
    );
  }
  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}
