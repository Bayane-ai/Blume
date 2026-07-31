// Provider basket (bloc 1) — API-SPORTS Basketball (v1.basketball.api-sports.io),
// même fournisseur et même compte que le football (lib/apiFootball.js,
// v3.football.api-sports.io) : un compte API-SPORTS authentifie généralement sur
// TOUTES ses API sportives avec la même clé (header x-apisports-key), chaque sport
// ayant simplement son propre quota. `API_BASKETBALL_KEY` prend le pas si elle est
// définie (compte/quota séparé) ; sinon la clé football existante (API_FOOTBALL_KEY)
// est réutilisée telle quelle — jamais besoin de configurer une deuxième variable si
// la première suffit déjà.
const BASE = "https://v1.basketball.api-sports.io";

export function getBasketballApiKey() {
  return process.env.API_BASKETBALL_KEY || process.env.API_FOOTBALL_KEY || null;
}

// Plan gratuit API-SPORTS : quota journalier (pas par minute) — même contrainte que
// lib/apiFootball.js, même mécanique de pause après un 429 pour ne pas enchaîner des
// appels voués à échouer jusqu'à la remise à zéro quotidienne.
const QUOTA_BACKOFF_MS = 60 * 60 * 1000; // 1h
let quotaBackoffUntil = 0;

async function basketballFetch(path, key) {
  if (!key) throw new Error("Clé API basket manquante (API_BASKETBALL_KEY ou API_FOOTBALL_KEY)");
  if (Date.now() < quotaBackoffUntil) {
    throw new Error("API-Basketball : pause en cours après un dépassement de quota (voir logs)");
  }
  const r = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": key } });
  if (r.status === 429) {
    quotaBackoffUntil = Date.now() + QUOTA_BACKOFF_MS;
    console.warn("[API-Basketball] 429 reçu (quota quotidien probablement dépassé) : pause d'environ 1h avant nouvel essai");
  }
  if (!r.ok) throw new Error(`API-Basketball a répondu ${r.status}`);
  const data = await r.json();
  const errors = data?.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : Object.keys(errors || {}).length > 0;
  if (hasErrors) throw new Error(`Erreur API-Basketball : ${JSON.stringify(errors)}`);
  return data?.response || [];
}

// Petit cache générique en mémoire (partagé par toutes les fonctions ci-dessous) :
// même principe que lib/apiFootball.js/lib/standingsCache.js — un seul appel réel en
// amont par fenêtre de temps, mutualisé entre tous les visiteurs, avec déduplication
// des requêtes en cours (plusieurs visiteurs qui arrivent pendant le même appel en
// vol ne déclenchent jamais un deuxième appel identique).
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

// Live : demandé "court" (30-60s, voir PROMPT bloc 1) — les visiteurs peuvent
// actualiser côté client bien plus souvent (15-30s), ce cache-ci borne le nombre
// d'appels réels vers API-Basketball indépendamment de leur fréquence de rafraîchissement.
const LIVE_GAMES_TTL_MS = 45000;
const liveGamesCache = makeCache(LIVE_GAMES_TTL_MS);

// Matchs à venir/terminés d'une date précise : changent bien moins vite que le direct.
const GAMES_BY_DATE_TTL_MS = 5 * 60 * 1000;
const gamesByDateCache = makeCache(GAMES_BY_DATE_TTL_MS);

const GAME_STATISTICS_TTL_MS = 2 * 60 * 1000;
const gameStatisticsCache = makeCache(GAME_STATISTICS_TTL_MS);

// Classements/statistiques d'équipe/de joueur : même TTL que lib/standingsCache.js
// (20 min) — ces données évoluent au fil de la saison, pas minute par minute.
const SEASON_DATA_TTL_MS = 20 * 60 * 1000;
const standingsCache = makeCache(SEASON_DATA_TTL_MS);
const teamStatisticsCache = makeCache(SEASON_DATA_TTL_MS);
const playerStatisticsCache = makeCache(SEASON_DATA_TTL_MS);
const teamPlayerStatisticsCache = makeCache(SEASON_DATA_TTL_MS);

// Derniers matchs RÉELS d'une équipe (bloc 3, profils statistiques) : change au
// rythme du calendrier, pas minute par minute — même TTL que les matchs à venir par
// date (5 min) suffit largement, avec un plancher raisonnable pour ne pas re-tirer
// l'historique complet d'une équipe à chaque rafraîchissement de la page pronostics.
const TEAM_GAMES_TTL_MS = 15 * 60 * 1000;
const teamGamesCache = makeCache(TEAM_GAMES_TTL_MS);

// Un match précis, par id — utilisé pour relire son score en direct (voir bloc 4) ou
// pour retrouver sa vraie saison quand elle n'est pas déjà connue.
const gameByIdCache = makeCache(LIVE_GAMES_TTL_MS);

// La liste des ligues/compétitions ne change quasiment jamais en cours de saison.
const LEAGUES_TTL_MS = 24 * 60 * 60 * 1000;
const leaguesCache = makeCache(LEAGUES_TTL_MS);

// TOUS les matchs actuellement en direct dans le monde, toutes compétitions et tous
// pays confondus (aucun paramètre de filtre) — NBA, EuroLeague, WNBA, NCAA,
// championnats nationaux... — voir PROMPT bloc 1, "toujours du basket en direct
// quelque part dans le monde".
export async function getLiveGames(key) {
  if (!key) return [];
  const games = await liveGamesCache.get("live", () => basketballFetch("/games?live=all", key));
  console.log(`[API-Basketball] /games?live=all : ${games.length} match(s) reçu(s)`);
  return games;
}

// Matchs (tous statuts) d'une date précise, toutes compétitions confondues.
export async function getGamesByDate(dateStr, key) {
  if (!key || !dateStr) return [];
  const games = await gamesByDateCache.get(dateStr, () => basketballFetch(`/games?date=${dateStr}`, key));
  console.log(`[API-Basketball] /games?date=${dateStr} : ${games.length} match(s) reçu(s)`);
  return games;
}

// Statistiques d'équipe pour UN match précis (points, rebonds, passes...).
export async function getGameStatistics(gameId, key) {
  if (!gameId || !key) return [];
  return gameStatisticsCache.get(String(gameId), () => basketballFetch(`/games/statistics?id=${gameId}`, key));
}

// Classement d'une compétition/saison précise.
export async function getStandings({ league, season }, key) {
  if (!league || !season || !key) return [];
  return standingsCache.get(`${league}-${season}`, () => basketballFetch(`/standings?league=${league}&season=${season}`, key));
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
  return leaguesCache.get("all", () => basketballFetch("/leagues", key));
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
