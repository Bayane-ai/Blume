// Provider tennis (bloc 5, multi-sport) — API-SPORTS Tennis (v1.tennis.api-sports.io),
// même fournisseur et même compte que le football/basket de ce projet (lib/apiFootball.js,
// lib/sports/basketball/provider.js) : un compte API-SPORTS authentifie généralement
// sur TOUTES ses API sportives avec la MÊME clé (en-tête x-apisports-key), chaque
// sport ayant simplement son propre quota. `API_TENNIS_KEY` prend le pas si elle est
// définie (compte/quota séparé) ; sinon la clé football déjà configurée
// (API_FOOTBALL_KEY) est réutilisée telle quelle — jamais besoin d'une deuxième
// variable si la première suffit déjà (voir getTennisApiKey ci-dessous).
//
// ⚠️ AVERTISSEMENT HONNÊTE (à lire avant de faire confiance à ce fichier) — l'API
// Tennis d'API-SPORTS est un produit RÉCENT (bêta au moment de l'écriture, voir la
// demande d'origine). Cet environnement de développement a une politique réseau qui
// bloque TOUT accès sortant vers api-sports.io ET api-tennis.com — vérifié avec de
// vraies requêtes HTTP (curl direct à travers le proxy réseau de cet environnement) :
// la réponse est un 403 "policy denial" DU PROXY DE CET ENVIRONNEMENT, jamais une
// réponse de l'API elle-même. Impossible donc de confirmer les noms d'endpoints ou la
// forme exacte des réponses contre le vrai service depuis ce sandbox. Les chemins
// ci-dessous suivent la convention déjà VÉRIFIÉE ET FONCTIONNELLE des autres API du
// même fournisseur dans ce projet (football via lib/apiFootball.js, basket via
// lib/sports/basketball/provider.js) : /games (pas /fixtures, réservé à football),
// /games/statistics, /players/statistics, /rankings, /leagues — mais restent une
// MEILLEURE ESTIMATION, pas une certitude absolue pour le tennis spécifiquement.
// Chaque fonction journalise (console.log) le nombre d'éléments réellement reçus —
// vérifie les logs Vercel après déploiement. Si un endpoint renvoie une erreur claire
// ("route non trouvée", 404, forme de réponse inattendue), dis-le : le chemin
// concerné se corrige en une ligne dans ce fichier.
import { recordLastError } from "../../apiQuota";

const BASE = "https://v1.tennis.api-sports.io";
const SPORT_KEY = "tennis";

export function getTennisApiKey() {
  return process.env.API_TENNIS_KEY || process.env.API_FOOTBALL_KEY || null;
}

// Plan gratuit/bêta API-SPORTS : quota journalier (pas par minute) — même contrainte
// que lib/apiFootball.js et lib/sports/basketball/provider.js, même mécanique de
// pause après un 429 pour ne pas enchaîner des appels voués à échouer jusqu'à la
// remise à zéro quotidienne.
const QUOTA_BACKOFF_MS = 60 * 60 * 1000; // 1h
let quotaBackoffUntil = 0;

async function tennisFetch(path, key) {
  try {
    if (!key) throw new Error("Clé API tennis manquante (API_TENNIS_KEY ou API_FOOTBALL_KEY)");
    if (Date.now() < quotaBackoffUntil) {
      throw new Error("API Tennis : pause en cours après un dépassement de quota (voir logs)");
    }
    const r = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": key } });
    if (r.status === 429) {
      quotaBackoffUntil = Date.now() + QUOTA_BACKOFF_MS;
      console.warn("[API-Tennis] 429 reçu (quota quotidien probablement dépassé) : pause d'environ 1h avant nouvel essai");
    }
    if (!r.ok) throw new Error(`API Tennis a répondu ${r.status} sur ${path}`);
    const data = await r.json();
    const errors = data?.errors;
    const hasErrors = Array.isArray(errors) ? errors.length > 0 : Object.keys(errors || {}).length > 0;
    if (hasErrors) throw new Error(`Erreur API Tennis : ${JSON.stringify(errors)}`);
    return data?.response || [];
  } catch (e) {
    console.error(`[API-Tennis] ${e.message}`);
    recordLastError(SPORT_KEY, e.message);
    throw e;
  }
}

// Petit cache générique en mémoire (même principe que lib/sports/basketball/
// provider.js#makeCache) : un seul appel réel en amont par fenêtre de temps,
// mutualisé entre tous les visiteurs, avec déduplication des requêtes en cours.
function makeCache(ttlMs) {
  const store = new Map();
  const inFlight = new Map();

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

// Live : demandé "court" (15-30s, voir PROMPT bloc 5) — les visiteurs peuvent
// actualiser côté client à cette fréquence, ce cache-ci borne le nombre d'appels
// réels vers API-Tennis indépendamment de leur fréquence de rafraîchissement. 20s au
// milieu de la fourchette demandée.
const LIVE_GAMES_TTL_MS = 20000;
const liveGamesCache = makeCache(LIVE_GAMES_TTL_MS);

// Matchs à venir/terminés d'une date précise : changent bien moins vite que le direct.
const GAMES_BY_DATE_TTL_MS = 5 * 60 * 1000;
const gamesByDateCache = makeCache(GAMES_BY_DATE_TTL_MS);

const GAME_STATISTICS_TTL_MS = 2 * 60 * 1000;
const gameStatisticsCache = makeCache(GAME_STATISTICS_TTL_MS);

// Classements ATP/WTA, statistiques de joueur, confrontations directes : évoluent au
// fil de la semaine/du tournoi, pas minute par minute — même TTL que lib/standingsCache.js.
const SEASON_DATA_TTL_MS = 20 * 60 * 1000;
const rankingsCache = makeCache(SEASON_DATA_TTL_MS);
const playerStatisticsCache = makeCache(SEASON_DATA_TTL_MS);
const h2hCache = makeCache(SEASON_DATA_TTL_MS);
const tournamentsCache = makeCache(SEASON_DATA_TTL_MS);

// Un match précis, par id — pour relire son score en direct (jeu par jeu si
// disponible) sans repasser par toute la liste des matchs en direct.
const gameByIdCache = makeCache(LIVE_GAMES_TTL_MS);

// TOUS les matchs actuellement en direct dans le monde, toutes catégories confondues
// (ATP, WTA, Grand Chelem, Masters 1000, ATP 250/500, Challengers, ITF — voir PROMPT
// bloc 5, point 3 : "il y a du tennis en direct presque 24h/24, ne filtre aucun
// tournoi") — aucun paramètre de filtre par catégorie.
export async function getLiveMatches(key) {
  if (!key) return [];
  const games = await liveGamesCache.get("live", () => tennisFetch("/games?live=all", key));
  console.log(`[API-Tennis] /games?live=all : ${games.length} match(s) reçu(s)`);
  return games;
}

// Matchs (tous statuts) d'une date précise, toutes catégories confondues.
export async function getMatchesByDate(dateStr, key) {
  if (!key || !dateStr) return [];
  const games = await gamesByDateCache.get(dateStr, () => tennisFetch(`/games?date=${dateStr}`, key));
  console.log(`[API-Tennis] /games?date=${dateStr} : ${games.length} match(s) reçu(s)`);
  return games;
}

// Relit un match précis par id (score/jeu en direct, set par set).
export async function getGameById(gameId, key) {
  if (!gameId || !key) return null;
  const games = await gameByIdCache.get(`id-${gameId}`, () => tennisFetch(`/games?id=${gameId}`, key));
  return games[0] || null;
}

// Statistiques d'UN match précis (aces, doubles fautes, % de premières balles, points
// gagnés au filet, etc. selon ce que la source fournit réellement) — utilisées à la
// fois pour enrichir un match terminé/en cours et, indirectement, pour le score
// "point par point" quand la source le fournit via les stats de jeu (voir mapper.js).
export async function getGameStatistics(gameId, key) {
  if (!gameId || !key) return [];
  return gameStatisticsCache.get(String(gameId), () => tennisFetch(`/games/statistics?id=${gameId}`, key));
}

// Classement ATP ou WTA — deux classements bien distincts, jamais mélangés (voir
// PROMPT bloc 5, point 2 : "classements ATP/WTA"). `tour` attendu : "ATP" ou "WTA".
export async function getRankings(tour, key) {
  if (!key || !tour) return [];
  const rankings = await rankingsCache.get(tour, () => tennisFetch(`/rankings?type=${tour}`, key));
  console.log(`[API-Tennis] /rankings?type=${tour} : ${rankings.length} joueur(s) classé(s) reçu(s)`);
  return rankings;
}

// Statistiques d'un joueur (identifiant + saison) — forme récente, moyennes de saison
// selon ce que la source fournit.
export async function getPlayerStatistics({ player, season }, key) {
  if (!player || !season || !key) return [];
  return playerStatisticsCache.get(
    `${player}-${season}`,
    () => tennisFetch(`/players/statistics?player=${player}&season=${season}`, key)
  );
}

// Derniers matchs RÉELS d'un joueur (n'importe quelle saison/tournoi suivi par
// API-Tennis) — base de la "forme récente" (PROMPT bloc 5, point 2 : "résultats
// récents (forme)") : même principe que lib/sports/basketball/provider.js#
// getTeamGames, dont lib/sports/basketball/statProfiles.js dérive une moyenne
// pondérée par récence. Le calcul de forme lui-même (bloc 7, pronostics tennis)
// n'est pas encore fait — cette fonction fournit seulement la vraie matière première,
// jamais un résultat inventé en attendant.
const playerGamesCache = makeCache(SEASON_DATA_TTL_MS);
export async function getPlayerGames({ player, season }, key) {
  if (!player || !season || !key) return [];
  const games = await playerGamesCache.get(
    `${player}-${season}`,
    () => tennisFetch(`/games?player=${player}&season=${season}`, key)
  );
  console.log(`[API-Tennis] /games?player=${player}&season=${season} : ${games.length} match(s) reçu(s)`);
  return games;
}

// Confrontations directes RÉELLES entre deux joueurs précis (jamais une estimation).
export async function getHeadToHead(player1Id, player2Id, key) {
  if (!player1Id || !player2Id || !key) return [];
  const pairKey = [String(player1Id), String(player2Id)].sort().join("-");
  const games = await h2hCache.get(pairKey, () => tennisFetch(`/games?h2h=${player1Id}-${player2Id}`, key));
  console.log(`[API-Tennis] h2h ${player1Id}-${player2Id} : ${games.length} confrontation(s) reçue(s)`);
  return games;
}

// TOUS les tournois/catégories disponibles, sans filtre (PROMPT bloc 5, point 3) —
// sert aussi à retrouver la surface d'un tournoi quand elle n'est pas déjà incluse
// directement dans la réponse d'un match (voir mapper.js, qui tente d'abord de lire
// la surface directement sur l'objet match avant de recourir à cet appel).
export async function getTournaments(season, key) {
  if (!key) return [];
  const cacheKey = season ? String(season) : "current";
  const tournaments = await tournamentsCache.get(cacheKey, () => tennisFetch(`/leagues${season ? `?season=${season}` : ""}`, key));
  return tournaments;
}
