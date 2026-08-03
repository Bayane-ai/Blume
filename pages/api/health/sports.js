// Diagnostic temps réel de CHAQUE source de données utilisée par le site (voir PROMPT :
// "écran vide généralisé, diagnostic automatique") — appelle réellement chaque API (jamais
// une simple lecture de cache) pour répondre sans ambiguïté à "la clé est-elle présente ?"
// et "que répond l'API EN CE MOMENT ?" (code HTTP exact, corps de l'erreur, quota restant).
//
// Gardée derrière l'authentification admin (même garde que /admin) : chaque appel de
// cette route déclenche de VRAIS appels réseau vers les 4 sources — jamais quelque chose
// à laisser un visiteur ordinaire déclencher à volonté (voir PROMPT, principe déjà établi
// partout ailleurs sur ce site : "aucun appel API déclenché par une visite utilisateur").
//
// Ne doit JAMAIS planter : chaque source est vérifiée indépendamment (Promise.allSettled),
// et chaque vérification a son propre try/catch — une source injoignable ou mal configurée
// ne doit jamais empêcher de connaître l'état des trois autres.
import { getSession } from "../../../lib/session";
import { isAdmin } from "../../../lib/auth/admin";
import { getBasketballApiKey, getLiveGames, getGamesByDate } from "../../../lib/sports/basketball/provider";
import { getTennisApiKey, getLiveMatches, getMatchesByDate } from "../../../lib/sports/tennis/provider";
import { readPersistentCache } from "../../../lib/apiSportsCache";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function checkFootballData() {
  const name = "football-data.org";
  const keyEnvVar = "FOOTBALL_DATA_TOKEN";
  const checkedAt = new Date().toISOString();
  const token = process.env.FOOTBALL_DATA_TOKEN || null;
  if (!token) {
    return { name, keyEnvVar, keyPresent: false, ok: false, httpStatus: null, errorBody: null, quota: null, checkedAt };
  }
  try {
    // Endpoint le plus léger disponible côté football-data.org (pas de /status dédié
    // sur cette API, contrairement à API-SPORTS ci-dessous) : la liste des compétitions,
    // rapide et peu coûteuse en quota.
    const r = await fetch(`${FOOTBALL_DATA_BASE}/competitions`, { headers: { "X-Auth-Token": token } });
    const remainingMinute = r.headers.get("x-requests-available-minute");
    let errorBody = null;
    if (!r.ok) {
      errorBody = (typeof r.text === "function" ? await r.text().catch(() => "") : "").slice(0, 500);
    }
    return {
      name,
      keyEnvVar,
      keyPresent: true,
      ok: r.ok,
      httpStatus: r.status,
      errorBody,
      quota: remainingMinute != null ? { remainingThisMinute: Number(remainingMinute) } : null,
      checkedAt,
    };
  } catch (e) {
    return { name, keyEnvVar, keyPresent: true, ok: false, httpStatus: null, errorBody: e.message, quota: null, checkedAt };
  }
}

// API-SPORTS (football/basket/tennis) expose un vrai /status renvoyant directement
// l'abonnement (actif ou non, plan) et le quota du jour (current / limit_day) — la
// réponse la plus fiable possible à "quota épuisé ou pas".
async function checkApiSportsStatus({ name, base, keyEnvVar, key }) {
  const checkedAt = new Date().toISOString();
  if (!key) {
    return { name, keyEnvVar, keyPresent: false, ok: false, httpStatus: null, errorBody: null, quota: null, checkedAt };
  }
  try {
    const r = await fetch(`${base}/status`, { headers: { "x-apisports-key": key } });
    let bodyJson = null;
    try {
      bodyJson = await r.json();
    } catch {
      // Corps non-JSON (page d'erreur HTML, etc.) : pas bloquant, on garde httpStatus.
    }
    if (!r.ok) {
      return {
        name, keyEnvVar, keyPresent: true, ok: false, httpStatus: r.status,
        errorBody: JSON.stringify(bodyJson || {}).slice(0, 500), quota: null, checkedAt,
      };
    }
    const account = bodyJson?.response;
    const quota = account
      ? {
          plan: account.subscription?.plan ?? null,
          subscriptionActive: account.subscription?.active ?? null,
          current: account.requests?.current ?? null,
          limitDay: account.requests?.limit_day ?? null,
        }
      : null;
    return { name, keyEnvVar, keyPresent: true, ok: true, httpStatus: r.status, errorBody: null, quota, checkedAt };
  } catch (e) {
    return { name, keyEnvVar, keyPresent: true, ok: false, httpStatus: null, errorBody: e.message, quota: null, checkedAt };
  }
}

// Basket : appelle RÉELLEMENT les mêmes fonctions que pages/api/basketball/live-matches.js
// et matches.js (jamais un appel séparé qui pourrait diverger du vrai chemin de code) —
// nombre de matchs live/à venir reçus AUJOURD'HUI, et fraîcheur du cache persistant
// (voir lib/apiSportsCache.js) pour chacun des deux. Ne jette jamais : une erreur ici
// est rapportée dans `matchesError`, jamais un plantage de toute la route.
async function checkBasketballMatches(key) {
  const today = todayUtc();
  try {
    const [live, upcoming, liveCache, upcomingCache] = await Promise.all([
      getLiveGames(key),
      getGamesByDate(today, key),
      readPersistentCache("basketball:live_all"),
      readPersistentCache(`basketball:upcoming:${today}`),
    ]);
    return {
      liveCount: live.length,
      upcomingCount: upcoming.length,
      cache: {
        live: liveCache ? { lastUpdated: new Date(liveCache.fetchedAt).toISOString() } : null,
        upcoming: upcomingCache ? { lastUpdated: new Date(upcomingCache.fetchedAt).toISOString() } : null,
      },
      matchesError: null,
    };
  } catch (e) {
    return { liveCount: null, upcomingCount: null, cache: null, matchesError: e.message };
  }
}

// Tennis : même principe, mais SANS cache persistant (voir lib/sports/tennis/
// provider.js — seulement un cache en mémoire, pas encore branché sur
// lib/apiSportsCache.js comme le basket) : `cache: null` reflète honnêtement cette
// absence, jamais une valeur inventée.
async function checkTennisMatches(key) {
  const today = todayUtc();
  try {
    const [live, upcoming] = await Promise.all([getLiveMatches(key), getMatchesByDate(today, key)]);
    return { liveCount: live.length, upcomingCount: upcoming.length, cache: null, matchesError: null };
  } catch (e) {
    return { liveCount: null, upcomingCount: null, cache: null, matchesError: e.message };
  }
}

function settledToResult(settled, name) {
  if (settled.status === "fulfilled") return settled.value;
  return {
    name,
    keyEnvVar: null,
    keyPresent: null,
    ok: false,
    httpStatus: null,
    errorBody: settled.reason?.message || "Erreur inattendue lors du diagnostic",
    quota: null,
    checkedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!isAdmin(session)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Non autorisé");
  }

  res.setHeader("Cache-Control", "no-store");

  const apiFootballKey = process.env.API_FOOTBALL_KEY || null;
  // getBasketballApiKey()/getTennisApiKey() (voir lib/sports/*/provider.js) sont LA
  // vraie source de vérité pour la clé effectivement utilisée par le reste du site
  // (même repli sur API_FOOTBALL_KEY) — jamais une lecture séparée de process.env qui
  // pourrait diverger de ce que ces routes utilisent réellement.
  const apiBasketballKey = getBasketballApiKey();
  const apiTennisKey = getTennisApiKey();

  const settled = await Promise.allSettled([
    checkFootballData(),
    checkApiSportsStatus({
      name: "API-Football", base: "https://v3.football.api-sports.io",
      keyEnvVar: "API_FOOTBALL_KEY", key: apiFootballKey,
    }),
    checkApiSportsStatus({
      name: "API-Basketball", base: "https://v1.basketball.api-sports.io",
      keyEnvVar: "API_BASKETBALL_KEY (ou API_FOOTBALL_KEY en repli)", key: apiBasketballKey,
    }),
    checkApiSportsStatus({
      name: "API-Tennis", base: "https://v1.tennis.api-sports.io",
      keyEnvVar: "API_TENNIS_KEY (ou API_FOOTBALL_KEY en repli)", key: apiTennisKey,
    }),
  ]);

  const names = ["football-data.org", "API-Football", "API-Basketball", "API-Tennis"];
  const sources = settled.map((s, i) => settledToResult(s, names[i]));

  // Nombre de matchs RÉELLEMENT récupérés (pas juste "la clé est valide") : répond à
  // "l'API répond correctement mais rien ne s'affiche" (voir PROMPT, point 3) — un
  // /status OK avec 0 match récupéré pointe vers un problème EN AVAL (parsing,
  // mapping, filtre), pas vers la clé ni le quota.
  if (apiBasketballKey) {
    const basketballSource = sources.find((s) => s.name === "API-Basketball");
    if (basketballSource) Object.assign(basketballSource, await checkBasketballMatches(apiBasketballKey));
  }
  if (apiTennisKey) {
    const tennisSource = sources.find((s) => s.name === "API-Tennis");
    if (tennisSource) Object.assign(tennisSource, await checkTennisMatches(apiTennisKey));
  }

  return res.status(200).json({
    checkedAt: new Date().toISOString(),
    sources,
  });
}
