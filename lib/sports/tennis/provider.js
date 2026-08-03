// Provider tennis — Live Tennis API (https://api.livetennisapi.com), un fournisseur
// DIFFÉRENT d'API-SPORTS (football/basket) : clé dédiée (TENNIS_API_KEY), schéma
// d'authentification différent (en-tête Authorization: Bearer), et un plan gratuit
// beaucoup plus restreint — seuls /matches?status=live, /matches/{id}/score et
// /players/{id} sont disponibles (pas d'historique, pas de classement dédié à part
// ce que /players/{id} renvoie, pas de cotes, pas de statistiques live détaillées, pas
// de WebSocket). Remplace l'intégration précédente (API-Tennis, elle-même jamais
// vérifiable depuis ce sandbox et abandonnée) — voir lib/sports/tennis/matchModel.js
// pour le moteur de calcul (inchangé, fonctions pures) et lib/sports/tennis/
// livePronostic.js pour comment ce plan gratuit limité est exploité au mieux.
//
// ⚠️ Forme exacte des réponses non vérifiable en direct depuis ce sandbox (réseau
// bloqué vers tout domaine tiers, confirmé à plusieurs reprises sur ce projet) : voir
// lib/sports/tennis/mapper.js pour les hypothèses de forme (documentées champ par
// champ) — jamais une donnée inventée quand un champ attendu est absent.
import { readPersistentCache, writePersistentCache } from "../../apiSportsCache";
import { recordLastError } from "../../apiQuota";

const BASE = "https://api.livetennisapi.com/api/public/v1";
const SPORT_KEY = "tennis";

export function getTennisApiKey() {
  return process.env.TENNIS_API_KEY || null;
}

// Quota STRICT et confirmé (voir PROMPT) : 30 requêtes/minute, 1000/jour — bien plus
// serré que le quota journalier seul d'API-SPORTS. Auto-limité ici avec une marge de
// sécurité (jamais pile sur la limite réelle, qui coupe brutalement) : les deux
// compteurs sont partagés entre TOUTES les instances serverless via le cache
// persistant (comme lib/apiQuota.js), sans quoi chaque instance froide repartirait de
// zéro et dépasserait le quota réel sous trafic concurrent.
const DAILY_CAP = 950; // marge sous les 1000/jour réels
const MINUTE_CAP = 28; // marge sous les 30/minute réels

function dayKey() {
  return `tennis:livetennisapi:day:${new Date().toISOString().slice(0, 10)}`;
}
function minuteKey() {
  return `tennis:livetennisapi:minute:${Math.floor(Date.now() / 60000)}`;
}

async function getCounter(key) {
  const entry = await readPersistentCache(key);
  return entry?.payload?.count || 0;
}

async function incrementCounter(key) {
  const current = await getCounter(key);
  writePersistentCache(key, { count: current + 1 });
}

async function isQuotaBlocked() {
  const [day, minute] = await Promise.all([getCounter(dayKey()), getCounter(minuteKey())]);
  return day >= DAILY_CAP || minute >= MINUTE_CAP;
}

// Consommation du jour — utilisée par pages/api/health/sports.js pour l'afficher sans
// deviner (jamais un chiffre déduit, toujours le compteur réel tenu par ce module).
export async function getTennisQuotaUsageToday() {
  const [day, minute] = await Promise.all([getCounter(dayKey()), getCounter(minuteKey())]);
  return { requestsToday: day, requestsThisMinute: minute, dailyCap: DAILY_CAP, minuteCap: MINUTE_CAP };
}

// GET /health — endpoint de connectivité EXPLICITEMENT sans clé (voir PROMPT) :
// utilisé pour valider que le service répond, jamais compté dans le quota (ce n'est
// pas un vrai appel de données) et jamais bloqué par isQuotaBlocked.
export async function checkTennisHealth() {
  try {
    const r = await fetch(`${BASE}/health`);
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: null, error: e.message };
  }
}

async function tennisFetch(path, key) {
  try {
    if (!key) throw new Error("Clé API tennis manquante (TENNIS_API_KEY)");
    if (await isQuotaBlocked()) {
      throw new Error("Live Tennis API : quota (30/min ou 1000/jour) atteint — pause, sert le cache");
    }
    const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${key}` } });
    // Compté dès qu'une vraie requête HTTP a été envoyée (succès ou échec applicatif) —
    // c'est la requête elle-même qui consomme le quota, pas seulement une réponse OK.
    await Promise.all([incrementCounter(dayKey()), incrementCounter(minuteKey())]);
    if (!r.ok) {
      const body = typeof r.text === "function" ? await r.text().catch(() => "") : "";
      throw new Error(`Live Tennis API a répondu ${r.status} sur ${path} : ${body.slice(0, 300)}`);
    }
    return await r.json();
  } catch (e) {
    console.error(`[LiveTennisAPI] ${e.message}`);
    recordLastError(SPORT_KEY, e.message);
    throw e;
  }
}

// Enveloppe de réponse non vérifiable en direct (voir avertissement en tête de
// fichier) : tente les clés les plus courantes pour une API REST de ce type
// (`matches`, `data`, tableau nu), jamais une valeur inventée si aucune ne correspond.
function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.matches)) return data.matches;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.response)) return data.response;
  return [];
}
function unwrapObject(data) {
  return data?.data || data?.match || data?.score || data?.player || data || null;
}

// Un seul appel partagé par TOUS les visiteurs (voir PROMPT, point 2), jamais un par
// utilisateur : le cache persistant sert de mutex de fait (toute instance qui trouve
// une entrée encore fraîche ne rappelle jamais l'API), et sa durée (60s, le plancher
// demandé) est ce qui borne réellement la consommation de quota sous trafic réel.
const LIVE_TTL_MS = 60 * 1000;
const LIVE_CACHE_KEY = "tennis:livetennisapi:live";

export async function getLiveMatches(key) {
  if (!key) return [];
  const persisted = await readPersistentCache(LIVE_CACHE_KEY);
  if (persisted && Date.now() - persisted.fetchedAt < LIVE_TTL_MS) return persisted.payload;
  try {
    const data = await tennisFetch("/matches?status=live", key);
    const matches = unwrapList(data);
    console.log(`[LiveTennisAPI] /matches?status=live : ${matches.length} match(s) reçu(s)`);
    writePersistentCache(LIVE_CACHE_KEY, matches);
    return matches;
  } catch (e) {
    // Jamais un écran vide silencieux : la dernière liste connue vaut mieux qu'une
    // erreur, tant qu'elle existe (voir PROMPT, même principe que football/basket).
    if (persisted) return persisted.payload;
    throw e;
  }
}

// Score détaillé (sets, jeux, point en cours, serveur) d'UN match précis — endpoint
// SÉPARÉ de la liste (voir PROMPT), donc un appel par match affiché en détail.
// Jamais bloquant pour l'affichage du match lui-même si ce détail échoue ou si le
// quota est déjà consommé : `null` en repli, la carte reste affichée avec ce que la
// liste elle-même fournissait déjà.
const SCORE_TTL_MS = 30 * 1000;

export async function getMatchScore(matchId, key) {
  if (!matchId || !key) return null;
  const cacheKey = `tennis:livetennisapi:score:${matchId}`;
  const persisted = await readPersistentCache(cacheKey);
  if (persisted && Date.now() - persisted.fetchedAt < SCORE_TTL_MS) return persisted.payload;
  try {
    const data = await tennisFetch(`/matches/${matchId}/score`, key);
    const score = unwrapObject(data);
    writePersistentCache(cacheKey, score);
    return score;
  } catch (e) {
    if (persisted) return persisted.payload;
    return null;
  }
}

// Profil joueur (nom, pays, classement s'il est fourni) — seule donnée "joueur"
// disponible sur ce plan gratuit (voir PROMPT : pas d'historique de matchs, pas de
// statistiques de service/retour réelles). Cache long (24h) : un classement ne
// change pas d'une minute à l'autre.
const PLAYER_TTL_MS = 24 * 3600 * 1000;

export async function getPlayer(playerId, key) {
  if (!playerId || !key) return null;
  const cacheKey = `tennis:livetennisapi:player:${playerId}`;
  const persisted = await readPersistentCache(cacheKey);
  if (persisted && Date.now() - persisted.fetchedAt < PLAYER_TTL_MS) return persisted.payload;
  try {
    const data = await tennisFetch(`/players/${playerId}`, key);
    const player = unwrapObject(data);
    writePersistentCache(cacheKey, player);
    return player;
  } catch (e) {
    if (persisted) return persisted.payload;
    return null;
  }
}
