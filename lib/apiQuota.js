// Suivi du quota API-SPORTS, INDÉPENDANT par sport (table api_quota_usage, voir
// supabase/migrations/0016_api_quota_usage.sql) — signalement réel : "lis les en-têtes
// x-ratelimit-requests-remaining renvoyés par l'API et journalise la consommation,
// compteur de quota indépendant par sport". Chaque provider (lib/apiFootball.js,
// lib/sports/basketball/provider.js, et tout sport ajouté plus tard) appelle
// recordQuotaUsage() juste après CHAQUE appel réel (succès ou échec applicatif, tant
// qu'une réponse HTTP a été reçue), et isQuotaExhausted() AVANT de tenter un nouvel
// appel — pour s'arrêter dès que le quota du jour est confirmé épuisé, plutôt que
// d'attendre le prochain 429 pour le découvrir. Jamais bloquant : toute erreur
// Supabase (table absente, indisponibilité...) est avalée ici, jamais remontée à
// l'appelant (voir lib/apiSportsCache.js pour le même principe déjà établi).
import { getSupabaseAdmin } from "./supabaseAdmin";
import { readPersistentCache, writePersistentCache } from "./apiSportsCache";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// Lit x-ratelimit-requests-remaining / x-ratelimit-requests-limit (convention
// API-SPORTS, la même sur tous ses produits — football, basketball...) sur la réponse
// HTTP réelle qui vient d'être reçue, et incrémente le compteur d'appels du jour pour
// CE sport. `response` est l'objet Response de fetch() ; passé tel quel plutôt qu'un
// simple objet d'en-têtes pour rester à l'épreuve d'un futur changement de client HTTP.
export async function recordQuotaUsage(sport, response) {
  try {
    const remainingRaw = response?.headers?.get?.("x-ratelimit-requests-remaining");
    const limitRaw = response?.headers?.get?.("x-ratelimit-requests-limit");
    const remaining = remainingRaw != null ? Number(remainingRaw) : null;
    const limit = limitRaw != null ? Number(limitRaw) : null;

    const supabase = getSupabaseAdmin();
    const day = todayUtc();
    const { data: existing } = await supabase
      .from("api_quota_usage")
      .select("requests_used")
      .eq("sport", sport)
      .eq("day", day)
      .maybeSingle();

    // Lecture puis écriture (pas un incrément atomique côté base) : une course entre
    // deux instances serverless concurrentes peut sous-compter de temps en temps —
    // acceptable pour un compteur de suivi/alerte, jamais utilisé pour une facturation
    // exacte. requests_remaining/-limit ne sont écrits que si l'API les a réellement
    // fournis cette fois (jamais écrasés par une valeur absente).
    await supabase.from("api_quota_usage").upsert({
      sport,
      day,
      requests_used: (existing?.requests_used || 0) + 1,
      ...(Number.isFinite(remaining) ? { requests_remaining: remaining } : {}),
      ...(Number.isFinite(limit) ? { requests_limit: limit } : {}),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Best effort — voir commentaire en tête de fichier.
  }
}

// `true` uniquement quand une preuve RÉELLE (en-tête API déjà observé aujourd'hui)
// montre que le quota est épuisé — jamais déduit d'une simple absence de donnée (pas
// d'en-tête connu = on tente quand même l'appel, comme avant l'ajout de ce module).
export async function isQuotaExhausted(sport) {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("api_quota_usage")
      .select("requests_remaining")
      .eq("sport", sport)
      .eq("day", todayUtc())
      .maybeSingle();
    return Number.isFinite(data?.requests_remaining) && data.requests_remaining <= 0;
  } catch {
    return false; // en cas de doute, ne jamais bloquer un appel réel
  }
}

// Consommation du jour pour UN sport — utilisé par la page admin (voir
// pages/admin/quota.js) et par les routes API pour dater un message "données mises à
// jour il y a X minutes" quand le quota est épuisé.
export async function getQuotaSnapshot(sport) {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("api_quota_usage")
      .select("requests_used, requests_remaining, requests_limit, updated_at")
      .eq("sport", sport)
      .eq("day", todayUtc())
      .maybeSingle();
    return {
      sport,
      requestsUsed: data?.requests_used ?? 0,
      requestsRemaining: data?.requests_remaining ?? null,
      requestsLimit: data?.requests_limit ?? null,
      updatedAt: data?.updated_at ?? null,
    };
  } catch {
    return { sport, requestsUsed: null, requestsRemaining: null, requestsLimit: null, updatedAt: null };
  }
}

// Même consommation, pour PLUSIEURS sports d'un coup (page admin) — jamais une liste
// de sports codée ailleurs que dans l'appelant : ce module reste sport-agnostique.
export async function getAllQuotaSnapshots(sports) {
  return Promise.all(sports.map((sport) => getQuotaSnapshot(sport)));
}

// Dernière erreur RÉELLE remontée par l'API pour ce sport (message d'exception tel
// quel — ex. "API-Basketball a répondu 403", ou le détail JSON renvoyé par l'API dans
// son champ `errors`), pour distinguer depuis /admin un vrai incident (abonnement
// manquant, panne) d'un simple quota épuisé sans devoir fouiller les logs Vercel.
// Réutilise le cache générique (lib/apiSportsCache.js) plutôt qu'une nouvelle table :
// c'est un repère de diagnostic ponctuel, pas une donnée à historiser.
export async function recordLastError(sport, message) {
  try {
    writePersistentCache(`${sport}:last_error`, { message, at: new Date().toISOString() });
  } catch {
    // Best effort — voir commentaire en tête de fichier.
  }
}

export async function getLastError(sport) {
  try {
    const entry = await readPersistentCache(`${sport}:last_error`);
    return entry?.payload || null;
  } catch {
    return null;
  }
}
