// Provider basket (bloc 1) — API-SPORTS Basketball (v1.basketball.api-sports.io),
// même fournisseur et même compte que le football (lib/apiFootball.js,
// v3.football.api-sports.io) : un compte API-SPORTS authentifie généralement sur
// TOUTES ses API sportives avec la même clé (header x-apisports-key), chaque sport
// ayant simplement son propre quota. `API_BASKETBALL_KEY` prend le pas si elle est
// définie (compte/quota séparé) ; sinon la clé football existante (API_FOOTBALL_KEY)
// est réutilisée telle quelle — jamais besoin de configurer une deuxième variable si
// la première suffit déjà.
import { readPersistentCache, writePersistentCache } from "../../apiSportsCache";
import { recordQuotaUsage, isQuotaExhausted } from "../../apiQuota";

const BASE = "https://v1.basketball.api-sports.io";
const SPORT_KEY = "basketball";

export function getBasketballApiKey() {
  return process.env.API_BASKETBALL_KEY || process.env.API_FOOTBALL_KEY || null;
}

// Plan gratuit API-SPORTS : quota journalier (pas par minute) — même contrainte que
// lib/apiFootball.js, même mécanique de pause après un 429 pour ne pas enchaîner des
// appels voués à échouer jusqu'à la remise à zéro quotidienne. Persistée (voir
// lib/apiSportsCache.js) pour que TOUTES les instances serverless respectent la pause,
// pas seulement celle qui a reçu le 429 (même raisonnement que lib/apiFootball.js).
const QUOTA_BACKOFF_MS = 60 * 60 * 1000; // 1h
let quotaBackoffUntil = 0;
const QUOTA_BACKOFF_CACHE_KEY = "basketball:quota_backoff_until";

async function isQuotaBackoffActive() {
  if (Date.now() < quotaBackoffUntil) return true;
  const persisted = await readPersistentCache(QUOTA_BACKOFF_CACHE_KEY);
  const until = Number(persisted?.payload?.until) || 0;
  if (until > quotaBackoffUntil) quotaBackoffUntil = until;
  return Date.now() < quotaBackoffUntil;
}

async function basketballFetch(path, key) {
  if (!key) throw new Error("Clé API basket manquante (API_BASKETBALL_KEY ou API_FOOTBALL_KEY)");
  if (await isQuotaBackoffActive()) {
    throw new Error("API-Basketball : pause en cours après un dépassement de quota (voir logs)");
  }
  // Arrêt PROACTIF dès que le dernier en-tête x-ratelimit-requests-remaining connu
  // confirme un quota à 0 aujourd'hui (voir lib/apiQuota.js) — pas besoin d'attendre
  // le prochain 429, qui gaspillerait un appel de plus.
  if (await isQuotaExhausted(SPORT_KEY)) {
    throw new Error("API-Basketball : quota quotidien épuisé (confirmé par l'API, voir page admin)");
  }
  const r = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": key } });
  recordQuotaUsage(SPORT_KEY, r); // fire-and-forget, voir lib/apiQuota.js
  if (r.status === 429) {
    quotaBackoffUntil = Date.now() + QUOTA_BACKOFF_MS;
    writePersistentCache(QUOTA_BACKOFF_CACHE_KEY, { until: quotaBackoffUntil });
    console.warn("[API-Basketball] 429 reçu (quota quotidien probablement dépassé) : pause d'environ 1h avant nouvel essai");
  }
  if (!r.ok) throw new Error(`API-Basketball a répondu ${r.status}`);
  const data = await r.json();
  const errors = data?.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : Object.keys(errors || {}).length > 0;
  if (hasErrors) throw new Error(`Erreur API-Basketball : ${JSON.stringify(errors)}`);
  return data?.response || [];
}

// Petit cache générique EN MÉMOIRE (partagé par toutes les fonctions ci-dessous) :
// protège la même instance serverless d'appels répétés en rafale (plusieurs visiteurs
// dans la même seconde). Ne survit PAS d'une instance froide à l'autre — c'est le
// cache PERSISTANT (lib/apiSportsCache.js, table Supabase partagée) ci-dessous qui
// protège réellement le quota journalier sous trafic réel, voir getLiveGames/
// getGamesByDate/getLeagues/getStandings.
function makeCache(ttlMs) {
  const store = new Map(); // clé -> { value, fetchedAt }
  const inFlight = new Map(); // clé -> promesse en cours

  return {
    async get(key, loader) {
      const cached = store.get(key);
      if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.value;

      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = (async () => {
        try {
          const value = await loader();
          store.set(key, { value, fetchedAt: Date.now() });
          return value;
        } catch (e) {
          // En cas d'échec, on retombe sur la dernière valeur connue si elle existe
          // (mieux qu'une liste vide pour un incident passager de l'API) — sinon on
          // laisse l'erreur remonter (jamais une donnée inventée pour la masquer).
          if (cached) return cached.value;
          throw e;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, promise);
      return promise;
    },
  };
}

// TTLs calibrés pour un quota de ~100 requêtes/jour (voir PROMPT) :
//   - Live : 10 min, ET seulement s'il existe un match plausible en cours/imminent
//     (voir hasLikelyLiveOrSoonGame ci-dessous) — en dehors de ces créneaux, zéro appel.
//   - Matchs à venir : 2 rafraîchissements/jour (12h).
//   - Championnats/classements/stats d'équipe/de joueur : 1 rafraîchissement/jour (24h).
const LIVE_GAMES_TTL_MS = 10 * 60 * 1000;
const liveGamesCache = makeCache(LIVE_GAMES_TTL_MS);

const GAMES_BY_DATE_TTL_MS = 12 * 60 * 60 * 1000;
const gamesByDateCache = makeCache(GAMES_BY_DATE_TTL_MS);

const GAME_STATISTICS_TTL_MS = 2 * 60 * 1000;
const gameStatisticsCache = makeCache(GAME_STATISTICS_TTL_MS);

const SEASON_DATA_TTL_MS = 24 * 60 * 60 * 1000;
const standingsCache = makeCache(SEASON_DATA_TTL_MS);
const teamStatisticsCache = makeCache(SEASON_DATA_TTL_MS);
const playerStatisticsCache = makeCache(SEASON_DATA_TTL_MS);
const teamPlayerStatisticsCache = makeCache(SEASON_DATA_TTL_MS);

// Derniers matchs RÉELS d'une équipe (bloc 3, profils statistiques) : change au
// rythme du calendrier, pas minute par minute.
const TEAM_GAMES_TTL_MS = 24 * 60 * 60 * 1000;
const teamGamesCache = makeCache(TEAM_GAMES_TTL_MS);

// Un match précis, par id — utilisé pour relire son score en direct (voir bloc 4) ou
// pour retrouver sa vraie saison quand elle n'est pas déjà connue.
const gameByIdCache = makeCache(LIVE_GAMES_TTL_MS);

// La liste des ligues/compétitions ne change quasiment jamais en cours de saison.
const LEAGUES_TTL_MS = 24 * 60 * 60 * 1000;
const leaguesCache = makeCache(LEAGUES_TTL_MS);

// Fenêtre "match plausiblement en cours ou imminent" (voir PROMPT : "au moins un match
// en cours ou démarrant dans l'heure") — un match NBA/EuroLeague dure ~2h avec la
// mi-temps ; 4h avant l'heure officielle de coup d'envoi couvre largement une
// prolongation ou un léger retard, sans jamais rater un match réellement en cours.
const LIVE_WINDOW_BEFORE_MS = 4 * 60 * 60 * 1000;
const LIVE_WINDOW_AFTER_MS = 60 * 60 * 1000;

// Décide s'il vaut la peine d'appeler /games?live=all — à partir des matchs À VENIR
// déjà mis en cache (persistant, partagé entre visiteurs/instances, voir
// getGamesByDate) : `true`/`false` quand on a une vraie réponse à donner, `null` quand
// on n'a AUCUNE donnée récente pour trancher (jamais vu de matchs à venir en cache) —
// dans ce dernier cas, on préfère tenter l'appel réel plutôt que de risquer de
// masquer à tort un vrai direct.
async function hasLikelyLiveOrSoonGame() {
  const now = Date.now();
  const days = [-1, 0, 1].map((offset) => new Date(now + offset * 24 * 3600000).toISOString().slice(0, 10));
  const entries = await Promise.all(days.map((d) => readPersistentCache(`basketball:upcoming:${d}`)));
  const knownEntries = entries.filter((e) => e && Array.isArray(e.payload));
  if (knownEntries.length === 0) return null;

  for (const entry of knownEntries) {
    for (const game of entry.payload) {
      const t = new Date(game?.date).getTime();
      if (Number.isFinite(t) && t >= now - LIVE_WINDOW_BEFORE_MS && t <= now + LIVE_WINDOW_AFTER_MS) {
        return true;
      }
    }
  }
  return false;
}

// TOUS les matchs actuellement en direct dans le monde, toutes compétitions et tous
// pays confondus (aucun paramètre de filtre) — NBA, EuroLeague, WNBA, NCAA,
// championnats nationaux... — voir PROMPT bloc 1, "toujours du basket en direct
// quelque part dans le monde".
export async function getLiveGames(key) {
  if (!key) return [];

  return liveGamesCache.get("live", async () => {
    // Avant tout appel réseau : une autre instance serverless a peut-être déjà une
    // réponse encore fraîche (le cache en mémoire ci-dessus ne survit pas d'une
    // instance froide à l'autre, voir lib/apiSportsCache.js).
    const persisted = await readPersistentCache("basketball:live_all");
    const persistedFresh = persisted && Date.now() - persisted.fetchedAt < LIVE_GAMES_TTL_MS;
    if (persistedFresh) return persisted.payload;

    // Zéro appel en dehors des créneaux plausibles (voir PROMPT) : sert le dernier
    // cache connu (même vide) plutôt que de consommer le quota pour rien.
    const plausible = await hasLikelyLiveOrSoonGame();
    if (plausible === false) {
      console.log("[API-Basketball] Aucun match plausible en direct/imminent : appel /games?live=all évité");
      return persisted?.payload || [];
    }

    try {
      const games = await basketballFetch("/games?live=all", key);
      console.log(`[API-Basketball] /games?live=all : ${games.length} match(s) reçu(s)`);
      writePersistentCache("basketball:live_all", games);
      return games;
    } catch (e) {
      if (persisted) return persisted.payload; // dernière copie connue plutôt qu'une liste vide
      throw e;
    }
  });
}

// Matchs (tous statuts) d'une date précise, toutes compétitions confondues.
export async function getGamesByDate(dateStr, key) {
  if (!key || !dateStr) return [];
  const cacheKey = `basketball:upcoming:${dateStr}`;

  return gamesByDateCache.get(dateStr, async () => {
    const persisted = await readPersistentCache(cacheKey);
    if (persisted && Date.now() - persisted.fetchedAt < GAMES_BY_DATE_TTL_MS) return persisted.payload;

    try {
      const games = await basketballFetch(`/games?date=${dateStr}`, key);
      console.log(`[API-Basketball] /games?date=${dateStr} : ${games.length} match(s) reçu(s)`);
      writePersistentCache(cacheKey, games);
      return games;
    } catch (e) {
      if (persisted) return persisted.payload;
      throw e;
    }
  });
}

// Statistiques d'équipe pour UN match précis (points, rebonds, passes...).
export async function getGameStatistics(gameId, key) {
  if (!gameId || !key) return [];
  return gameStatisticsCache.get(String(gameId), () => basketballFetch(`/games/statistics?id=${gameId}`, key));
}

// Classement d'une compétition/saison précise.
export async function getStandings({ league, season }, key) {
  if (!league || !season || !key) return [];
  const cacheKey = `basketball:standings:${league}-${season}`;
  return standingsCache.get(`${league}-${season}`, async () => {
    const persisted = await readPersistentCache(cacheKey);
    if (persisted && Date.now() - persisted.fetchedAt < SEASON_DATA_TTL_MS) return persisted.payload;
    try {
      const rows = await basketballFetch(`/standings?league=${league}&season=${season}`, key);
      writePersistentCache(cacheKey, rows);
      return rows;
    } catch (e) {
      if (persisted) return persisted.payload;
      throw e;
    }
  });
}

// Statistiques d'une équipe sur une compétition/saison précise.
export async function getTeamStatistics({ league, season, team }, key) {
  if (!league || !season || !team || !key) return null;
  const rows = await teamStatisticsCache.get(
    `${league}-${season}-${team}`,
    () => basketballFetch(`/teams/statistics?league=${league}&season=${season}&team=${team}`, key)
  );
  // Contrairement aux autres endpoints (toujours un tableau), /teams/statistics
  // renvoie un objet unique dans `response` pour une équipe/saison donnée.
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

// Statistiques d'un joueur (identifiant + saison).
export async function getPlayerStatistics({ id, season }, key) {
  if (!id || !season || !key) return [];
  return playerStatisticsCache.get(`${id}-${season}`, () => basketballFetch(`/players/statistics?id=${id}&season=${season}`, key));
}

// TOUTES les ligues/compétitions disponibles, sans filtre (PROMPT bloc 1, point 3 :
// "TOUTES les compétitions disponibles, sans filtre").
export async function getLeagues(key) {
  if (!key) return [];
  const cacheKey = "basketball:leagues";
  return leaguesCache.get("all", async () => {
    const persisted = await readPersistentCache(cacheKey);
    if (persisted && Date.now() - persisted.fetchedAt < LEAGUES_TTL_MS) return persisted.payload;
    try {
      const leagues = await basketballFetch("/leagues", key);
      writePersistentCache(cacheKey, leagues);
      return leagues;
    } catch (e) {
      if (persisted) return persisted.payload;
      throw e;
    }
  });
}

// Bloc 3 (pronostics basket) — les vrais derniers matchs joués par UNE équipe
// (n'importe quelle saison, n'importe quelle compétition suivie par API-SPORTS) :
// base réelle du profil statistique de l'équipe (voir lib/sports/basketball/
// statProfiles.js), jamais une moyenne de championnat générique.
export async function getTeamGames({ team, season }, key) {
  if (!team || !season || !key) return [];
  const games = await teamGamesCache.get(`${team}-${season}`, () => basketballFetch(`/games?team=${team}&season=${season}`, key));
  console.log(`[API-Basketball] /games?team=${team}&season=${season} : ${games.length} match(s) reçu(s)`);
  return games;
}

// Bloc 4 (live) — relit un match précis par id (score/quart-temps en direct, ou
// simplement retrouver sa saison réelle) sans avoir à reparcourir toute la liste des
// matchs en direct.
export async function getGameById(gameId, key) {
  if (!gameId || !key) return null;
  const games = await gameByIdCache.get(`id-${gameId}`, () => basketballFetch(`/games?id=${gameId}`, key));
  return games[0] || null;
}

// Statistiques RÉELLES de tous les joueurs d'une équipe pour une saison — base du
// bloc "Joueurs à suivre" (voir lib/sports/basketball/playerProps.js), jamais un
// joueur inventé.
export async function getTeamPlayerStatistics({ team, season }, key) {
  if (!team || !season || !key) return [];
  return teamPlayerStatisticsCache.get(
    `${team}-${season}`,
    () => basketballFetch(`/players/statistics?team=${team}&season=${season}`, key)
  );
}
