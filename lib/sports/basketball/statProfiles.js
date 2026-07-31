// Bloc 3 (pronostics basket) — profil statistique RÉEL par équipe, calculé à partir
// de ses derniers matchs réellement joués (voir lib/sports/basketball/provider.js),
// avec répartition domicile/extérieur : même principe que lib/teamStatProfiles.js
// pour le football (forme récente pondérée par récence, jamais une constante
// partagée entre équipes ou entre matchs), adapté aux métriques basket.
//
// Contrairement au football (persisté dans Supabase, voir team_stat_profiles), ce
// profil est mis en cache EN MÉMOIRE seulement (24h) : plus simple, suffisant pour
// ce bloc — aucune migration à exécuter avant que les pronostics basket ne
// fonctionnent. Toujours de vraies données API, jamais une valeur inventée.
import { getTeamGames, getGameStatistics } from "./provider";
import { mapGameStatusToBlumeStatus } from "./mapper";

const MAX_RECENT_GAMES = 10;
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

const profileCache = new Map(); // "teamId-season" -> { profile, fetchedAt }
const profileInFlight = new Map();

const FIELD_KEYS = ["pointsFor", "pointsAgainst", "rebounds", "assists", "threePointersMade", "fouls", "turnovers", "freeThrowsMade"];

function emptyBucket() {
  const b = {};
  for (const k of FIELD_KEYS) b[k] = [];
  b.q1Share = [];
  b.firstHalfShare = [];
  return b;
}

function push(bucket, key, value, weight) {
  if (value == null || !Number.isFinite(value)) return;
  bucket[key].push({ value, weight });
}

// Matchs les plus récents pondérés plus fort (le plus ancien retenu = poids 1, le
// plus récent = poids N) — même mécanique que lib/teamStatProfiles.js#recencyWeight.
function recencyWeight(indexFromOldest) {
  return indexFromOldest + 1;
}

function weightedAverage(pairs) {
  if (!pairs.length) return null;
  const totalWeight = pairs.reduce((a, p) => a + p.weight, 0);
  if (totalWeight <= 0) return null;
  return pairs.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight;
}

// Écart-type pondéré RÉEL des points marqués/encaissés d'une équipe — utilisé par le
// modèle de probabilité de victoire (loi normale, voir lib/sports/basketball/
// normalDist.js) : jamais une variance de Poisson supposée, la vraie dispersion de
// CETTE équipe sur ses derniers matchs.
function weightedStdDev(pairs, mean) {
  if (pairs.length < 2 || mean == null) return null;
  const totalWeight = pairs.reduce((a, p) => a + p.weight, 0);
  if (totalWeight <= 0) return null;
  const variance = pairs.reduce((a, p) => a + p.weight * (p.value - mean) ** 2, 0) / totalWeight;
  return Math.sqrt(Math.max(0, variance));
}

function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

// Une statistique brute d'API-Basketball peut être un nombre, une chaîne numérique,
// ou une fraction "makes/attempts" (ex: "5/12" pour les tirs à 3 points réussis/
// tentés) — ne garde que la partie "réussite" (numérateur), jamais les tentatives.
export function parseStatValue(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const frac = raw.match(/^(\d+)\s*\/\s*\d+$/);
    if (frac) return Number(frac[1]);
    const n = parseFloat(raw.replace("%", ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Plusieurs libellés possibles selon la source exacte (voir le commentaire de
// lib/sports/basketball/provider.js#getGameStatistics — forme exacte non vérifiable
// depuis cet environnement, réseau restreint) : on retient le premier libellé connu
// trouvé, jamais une valeur inventée si aucun ne correspond.
export const STAT_ALIASES = {
  rebounds: ["Total Rebounds", "Rebounds", "Reb"],
  assists: ["Assists"],
  threePointersMade: ["3 Points", "3-Points", "Three Pointers Made", "3PT Made", "Field Goals 3PT", "3P"],
  fouls: ["Personal Fouls", "Fouls"],
  turnovers: ["Turnovers"],
  freeThrowsMade: ["Free Throws", "Free Throws Made", "FT"],
};

export function statisticValue(list, aliases) {
  if (!Array.isArray(list)) return null;
  for (const alias of aliases) {
    const entry = list.find((s) => (s?.type || "").toLowerCase() === alias.toLowerCase());
    if (entry) {
      const v = parseStatValue(entry.value);
      if (v != null) return v;
    }
  }
  return null;
}

// Ajoute au bucket domicile OU extérieur (jamais les deux) les champs d'UN match
// réellement joué par cette équipe — buts/points déjà connus via /games (scores),
// le reste (rebonds, passes, 3 points, fautes, ballons perdus, lancers francs) via
// /games/statistics (un appel par match, mis en cache par le provider).
async function collectMatchFields(bucket, { isHome, game, teamId, weight, apiKey }) {
  const home = game?.scores?.home;
  const away = game?.scores?.away;
  const ownScore = isHome ? home : away;
  const oppScore = isHome ? away : home;
  const pointsFor = ownScore?.total;
  const pointsAgainst = oppScore?.total;
  push(bucket, "pointsFor", pointsFor, weight);
  push(bucket, "pointsAgainst", pointsAgainst, weight);

  // Part RÉELLE du 1er quart-temps / de la 1ère mi-temps dans le total de CETTE
  // équipe sur CE match — jamais une part fixe recopiée (contrairement au football,
  // qui n'a pas cette granularité par quart-temps, voir lib/pronostic.js#FIRST_HALF
  // _SHARE) : chaque équipe a son propre rythme réel.
  const q1 = ownScore?.quarter_1;
  const q2 = ownScore?.quarter_2;
  if (Number.isFinite(q1) && Number.isFinite(pointsFor) && pointsFor > 0) {
    push(bucket, "q1Share", q1 / pointsFor, weight);
  }
  if (Number.isFinite(q1) && Number.isFinite(q2) && Number.isFinite(pointsFor) && pointsFor > 0) {
    push(bucket, "firstHalfShare", (q1 + q2) / pointsFor, weight);
  }

  const stats = await getGameStatistics(game.id, apiKey);
  const teamEntry = Array.isArray(stats) ? stats.find((s) => String(s?.team?.id) === String(teamId)) : null;
  const list = teamEntry?.statistics;
  push(bucket, "rebounds", statisticValue(list, STAT_ALIASES.rebounds), weight);
  push(bucket, "assists", statisticValue(list, STAT_ALIASES.assists), weight);
  push(bucket, "threePointersMade", statisticValue(list, STAT_ALIASES.threePointersMade), weight);
  push(bucket, "fouls", statisticValue(list, STAT_ALIASES.fouls), weight);
  push(bucket, "turnovers", statisticValue(list, STAT_ALIASES.turnovers), weight);
  push(bucket, "freeThrowsMade", statisticValue(list, STAT_ALIASES.freeThrowsMade), weight);
}

function buildField(pairs) {
  const value = weightedAverage(pairs);
  return { value: round1(value), sampleSize: pairs.length, available: value != null };
}

function buildSplitBlock(bucket) {
  const block = {};
  for (const key of FIELD_KEYS) block[key] = buildField(bucket[key]);
  const pointsForMean = weightedAverage(bucket.pointsFor);
  const pointsAgainstMean = weightedAverage(bucket.pointsAgainst);
  block.pointsFor.stdDev = round1(weightedStdDev(bucket.pointsFor, pointsForMean));
  block.pointsAgainst.stdDev = round1(weightedStdDev(bucket.pointsAgainst, pointsAgainstMean));
  block.q1Share = { value: weightedAverage(bucket.q1Share), sampleSize: bucket.q1Share.length, available: bucket.q1Share.length > 0 };
  block.firstHalfShare = {
    value: weightedAverage(bucket.firstHalfShare), sampleSize: bucket.firstHalfShare.length, available: bucket.firstHalfShare.length > 0,
  };
  return block;
}

// Calcule (ou relit depuis le cache mémoire, 24h) le profil complet d'une équipe —
// TOUJOURS ses propres derniers matchs réellement joués, jamais mélangés avec une
// autre équipe ni un autre match.
export async function getOrRefreshTeamProfile({ teamId, teamName, season, apiKey }) {
  if (!teamId || !season || !apiKey) {
    return { available: false, reason: "identifiant d'équipe, saison ou clé API manquants" };
  }
  const cacheKey = `${teamId}-${season}`;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PROFILE_TTL_MS) return cached.profile;

  const pending = profileInFlight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const rawGames = await getTeamGames({ team: teamId, season }, apiKey);
      const finished = rawGames
        .filter((g) => mapGameStatusToBlumeStatus(g?.status?.short) === "FINISHED")
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(-MAX_RECENT_GAMES);

      const homeBucket = emptyBucket();
      const awayBucket = emptyBucket();
      await Promise.all(
        finished.map((game, i) => {
          const weight = recencyWeight(i);
          const isHome = String(game?.teams?.home?.id) === String(teamId);
          return collectMatchFields(isHome ? homeBucket : awayBucket, { isHome, game, teamId, weight, apiKey });
        })
      );

      const profile = {
        available: finished.length > 0,
        teamId, teamName, matchesUsed: finished.length,
        home: buildSplitBlock(homeBucket),
        away: buildSplitBlock(awayBucket),
      };
      if (!profile.available) profile.reason = "aucun match récent terminé trouvé pour cette équipe";
      profileCache.set(cacheKey, { profile, fetchedAt: Date.now() });
      console.log(`[Basket] Profil ${teamName || teamId} (saison ${season}) : ${finished.length} match(s) récents utilisés`);
      return profile;
    } finally {
      profileInFlight.delete(cacheKey);
    }
  })();
  profileInFlight.set(cacheKey, promise);
  return promise;
}
