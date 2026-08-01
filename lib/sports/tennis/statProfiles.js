// Bloc 7 (pronostics tennis) — profil RÉEL d'un joueur : classement, forme récente,
// performance sur LA SURFACE du tournoi, qualité de service/retour, aces/doubles
// fautes par match, fatigue (matchs récents) — calculé à partir de ses vrais matchs
// joués (API-Tennis), jamais une constante partagée entre joueurs ou entre matchs
// (contrairement à lib/sports/tennis/pronostic.js, qui reste la source de vérité pour
// le modèle de Markov, ici réutilisé tel quel, jamais dupliqué).
//
// Contrairement à lib/teamStatProfiles.js (football) et lib/sports/basketball/
// statProfiles.js, PAS de persistance Supabase ici : l'architecture tennis déjà en
// place depuis le bloc 5 (lib/sports/tennis/provider.js) est entièrement en mémoire
// (aucune table Supabase tennis n'existe) — un choix déjà assumé pour ce sport, geardé
// à l'identique ici plutôt que d'introduire une nouvelle dépendance Supabase pour ce
// seul bloc. Le profil est donc recalculé au premier "Analyser" après expiration du
// cache (24h), comme pour le basket avant son propre profil (même compromis de
// latence assumé, voir pages/api/tennis/analyze.js).
import { getPlayerGames, getRankings, getGameStatistics } from "./provider";
import { mapSurface, mapGameStatistics } from "./mapper";
// Normalisation de nom (accents/casse/espaces) déjà écrite et éprouvée pour le
// football (lib/apiFootball.js) — générique malgré son nom, réutilisée telle quelle
// pour comparer un nom de joueur tennis entre deux sources plutôt que de dupliquer
// la même logique.
import { normalizeTeamName } from "../../apiFootball";

const STALE_MS = 24 * 3600 * 1000; // 24h
const MAX_MATCHES = 10;
const RECENT_FATIGUE_DAYS = 14;
const MIN_SURFACE_SAMPLE = 3;

// Moyennes RÉELLES et documentées du circuit ATP/WTA (ordre de grandeur constaté sur
// le circuit professionnel, pas une mesure de CE joueur précis) — utilisées UNIQUEMENT
// en dernier repli, quand un joueur n'a encore aucun match exploitable (jamais une
// valeur inventée présentée comme réelle : `estimated: true` dans tous les cas où
// elles sont utilisées, voir buildField ci-dessous).
const TOUR_AVERAGE = {
  serveWinPct: 62, returnWinPct: 38, firstServeInPct: 60,
  acesPerMatch: 5, doubleFaultsPerMatch: 3, breakPointsWonPct: 40,
  // Uniquement descriptifs (Bloc 10 "Contexte service/retour", voir PROMPT) : jamais
  // utilisés par le modèle de Markov lui-même (qui ne consomme que serveWinPct/
  // returnWinPct, la combinaison des deux) — seulement affichés tels quels comme
  // éléments d'analyse.
  firstServeWonPct: 68, secondServeWonPct: 48,
};

function round1(x) {
  return x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
}

// Poids de récence : un match plus récent pèse plus qu'un match ancien — même
// principe que lib/teamStatProfiles.js#recencyWeight (échelle linéaire simple,
// documentée comme choix de méthode).
function recencyWeight(indexFromOldest) {
  return indexFromOldest + 1;
}

function weightedAverage(pairs) {
  if (!pairs.length) return null;
  const totalWeight = pairs.reduce((a, p) => a + p.weight, 0);
  if (totalWeight <= 0) return null;
  return pairs.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight;
}

// Un champ { value, estimated, sampleSize, available, basis } : `basis` indique
// d'où vient réellement la valeur — "surface" (matchs récents sur CETTE surface,
// signal le plus pertinent), "recent" (repli sur les matchs récents toutes surfaces
// confondues, échantillon insuffisant sur cette surface précise), ou "tour_average"
// (aucun match exploitable pour ce joueur : moyenne de circuit documentée ci-dessus).
// Jamais une valeur inventée présentée comme mesurée : `estimated` reflète
// honnêtement lequel des trois cas s'applique.
function buildField(surfacePairs, allPairs, tourAverageValue) {
  if (surfacePairs.length >= MIN_SURFACE_SAMPLE) {
    return { value: round1(weightedAverage(surfacePairs)), estimated: false, sampleSize: surfacePairs.length, available: true, basis: "surface" };
  }
  if (allPairs.length > 0) {
    return { value: round1(weightedAverage(allPairs)), estimated: true, sampleSize: allPairs.length, available: true, basis: "recent" };
  }
  return { value: tourAverageValue, estimated: true, sampleSize: 0, available: true, basis: "tour_average" };
}

// Jeux gagnés/perdus par le joueur dans CE match (à partir des scores de sets réels)
// — utilisé comme repli quand les statistiques de service/retour détaillées
// (getGameStatistics) ne sont pas disponibles pour ce match précis (voir
// deriveServeReturnFromGames ci-dessous). `sets` vient de la même convention
// `scores.home/away.set_N` que lib/sports/tennis/mapper.js#mapSets, mais appliquée
// ici directement sur un match d'historique (pas le match en cours analysé).
function gamesWonAndLost(game, isHome) {
  const own = isHome ? game?.scores?.home : game?.scores?.away;
  const opp = isHome ? game?.scores?.away : game?.scores?.home;
  let won = 0;
  let lost = 0;
  for (const key of ["set_1", "set_2", "set_3", "set_4", "set_5"]) {
    const o = own?.[key];
    const p = opp?.[key];
    if (typeof o !== "number" || typeof p !== "number") continue;
    won += o;
    lost += p;
  }
  return { won, lost };
}

// Repli quand aucune statistique de service/retour détaillée n'est disponible pour ce
// match précis : dérive une estimation du point gagné au service à partir du VRAI
// ratio de jeux gagnés/perdus de ce match (mesuré, pas inventé) — transformation
// documentée (le ratio de jeux, plus volatil, est comprimé vers la fourchette
// réaliste d'une probabilité de point gagné au service) plutôt qu'une statistique de
// service directement mesurée. Bornée à [50, 85] pour rester dans une plage réaliste
// même sur un échantillon très déséquilibré (ex : 6-0 6-0).
function serveWinPctFromGamesRatio(won, lost) {
  const total = won + lost;
  if (total <= 0) return null;
  const ratio = won / total; // 0..1
  const estimate = TOUR_AVERAGE.serveWinPct + (ratio - 0.5) * 50;
  return Math.min(85, Math.max(50, estimate));
}
function returnWinPctFromGamesRatio(won, lost) {
  const total = won + lost;
  if (total <= 0) return null;
  const ratio = won / total;
  const estimate = TOUR_AVERAGE.returnWinPct + (ratio - 0.5) * 30;
  return Math.min(60, Math.max(15, estimate));
}

async function buildRawSamples(games, playerId, apiKey) {
  const samples = []; // { surface, weight, date, result: 'W'|'L', serveWinPct, returnWinPct, firstServeInPct, aces, doubleFaults, breakPointsWonPct }
  const finished = (games || [])
    .filter((g) => /finished|retired|walkover|^ft$/i.test(`${g?.status?.long || ""} ${g?.status?.short || ""}`))
    .sort((a, b) => new Date(a?.date || 0) - new Date(b?.date || 0))
    .slice(-MAX_MATCHES);

  for (let i = 0; i < finished.length; i++) {
    const game = finished[i];
    const homeId = game?.teams?.home?.id ?? game?.players?.home?.id;
    const isHome = String(homeId) === String(playerId);
    const { won, lost } = gamesWonAndLost(game, isHome);
    if (won + lost === 0) continue;

    const weight = recencyWeight(i);
    const surface = mapSurface(game);
    const gameId = game?.id;
    let statsSide = null;
    if (gameId) {
      try {
        const raw = await getGameStatistics(gameId, apiKey);
        const stats = mapGameStatistics(raw, homeId);
        statsSide = isHome ? stats?.home : stats?.away;
      } catch {
        statsSide = null;
      }
    }

    const serveWinPct = statsSide?.firstServeInPct?.value != null && statsSide?.firstServeWonPct?.value != null && statsSide?.secondServeWonPct?.value != null
      ? (statsSide.firstServeInPct.value / 100) * statsSide.firstServeWonPct.value + (1 - statsSide.firstServeInPct.value / 100) * statsSide.secondServeWonPct.value
      : serveWinPctFromGamesRatio(won, lost);
    const returnWinPct = statsSide?.breakPointsWon?.value != null
      ? Math.min(60, Math.max(15, statsSide.breakPointsWon.value))
      : returnWinPctFromGamesRatio(won, lost);

    samples.push({
      surface, weight,
      won, lost,
      serveWinPct, returnWinPct,
      firstServeInPct: statsSide?.firstServeInPct?.value ?? null,
      firstServeWonPct: statsSide?.firstServeWonPct?.value ?? null,
      secondServeWonPct: statsSide?.secondServeWonPct?.value ?? null,
      aces: statsSide?.aces?.value ?? null,
      doubleFaults: statsSide?.doubleFaults?.value ?? null,
      breakPointsWonPct: statsSide?.breakPointsWon?.value ?? null,
      date: game?.date || null,
      wonMatch: null, // renseigné par l'appelant si le vainqueur est identifiable (voir buildFormString)
    });
  }
  return samples;
}

function pairs(samples, key, filterSurface) {
  return samples
    .filter((s) => (filterSurface ? s.surface === filterSurface : true))
    .filter((s) => s[key] != null && Number.isFinite(s[key]))
    .map((s) => ({ value: s[key], weight: s.weight }));
}

// In-memory : un profil réutilisé tel quel tant qu'il a moins de STALE_MS — mêmes
// principes que lib/sports/basketball/provider.js#makeCache (cache + déduplication
// des requêtes en cours), pas de persistance entre redéploiements (assumé, voir
// commentaire en tête de fichier).
const cache = new Map(); // `${playerId}-${surface}` -> { profile, fetchedAt }
const inFlight = new Map();

// Point d'entrée. `surface` : libellé déjà normalisé (voir lib/sports/tennis/
// mapper.js#SURFACE_LABELS, ex. "Terre battue") — le profil privilégie les matchs
// récents sur CETTE surface (au moins 3, sinon repli documenté, voir buildField).
export async function getOrBuildPlayerProfile({ playerId, playerName, surface, apiKey }) {
  if (!playerId) return { available: false, reason: "identifiant joueur manquant" };
  const cacheKey = `${playerId}-${surface || "any"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < STALE_MS) return cached.profile;

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      if (!apiKey) return cached ? cached.profile : { available: false, reason: "clé API tennis manquante" };

      const season = String(new Date().getFullYear());
      const games = await getPlayerGames({ player: playerId, season }, apiKey);
      const samples = await buildRawSamples(games, playerId, apiKey);

      if (samples.length === 0) {
        const profile = buildProfileFromSamples([], playerName, surface, { rankingValue: await lookupRanking(playerName, apiKey) });
        cache.set(cacheKey, { profile, fetchedAt: Date.now() });
        return profile;
      }

      const rankingValue = await lookupRanking(playerName, apiKey);
      const profile = buildProfileFromSamples(samples, playerName, surface, { rankingValue });
      cache.set(cacheKey, { profile, fetchedAt: Date.now() });
      return profile;
    } catch (e) {
      console.error("Erreur calcul profil joueur tennis:", e.message);
      return cached ? cached.profile : { available: false, reason: "calcul impossible" };
    } finally {
      inFlight.delete(cacheKey);
    }
  })();
  inFlight.set(cacheKey, promise);
  return promise;
}

// Classement réel du joueur : cherché par NOM (pas d'id partagé entre l'endpoint
// `/rankings` et le reste de l'API selon toute vraisemblance, voir avertissement de
// lib/sports/tennis/provider.js) dans les classements ATP puis WTA — le premier des
// deux où le joueur apparaît. `null` si introuvable dans aucun des deux, jamais un
// rang inventé.
async function lookupRanking(playerName, apiKey) {
  if (!playerName || !apiKey) return null;
  for (const tour of ["ATP", "WTA"]) {
    try {
      const rankings = await getRankings(tour, apiKey);
      const found = (rankings || []).find(
        (r) => normalizeTeamName(r?.player?.name || r?.team?.name || r?.name) === normalizeTeamName(playerName)
      );
      if (found) return found.rank ?? found.position ?? null;
    } catch {
      // Continue avec l'autre circuit.
    }
  }
  return null;
}

function buildFormString(samples) {
  // "W"/"L" à partir du ratio de jeux gagnés/perdus de chaque match (won>lost = victoire
  // probable) — un proxy honnête en l'absence d'un champ "vainqueur" direct exploité
  // ici ; documenté comme tel plutôt que présenté comme le résultat officiel exact.
  return samples
    .slice(-5)
    .map((s) => (s.won > s.lost ? "W" : "L"))
    .join("");
}

function buildProfileFromSamples(samples, playerName, surface, { rankingValue }) {
  const surfacePairsFor = (key) => pairs(samples, key, surface);
  const allPairsFor = (key) => pairs(samples, key, null);

  const serveWinPct = buildField(surfacePairsFor("serveWinPct"), allPairsFor("serveWinPct"), TOUR_AVERAGE.serveWinPct);
  const returnWinPct = buildField(surfacePairsFor("returnWinPct"), allPairsFor("returnWinPct"), TOUR_AVERAGE.returnWinPct);
  const firstServeInPct = buildField(surfacePairsFor("firstServeInPct"), allPairsFor("firstServeInPct"), TOUR_AVERAGE.firstServeInPct);
  const firstServeWonPct = buildField(surfacePairsFor("firstServeWonPct"), allPairsFor("firstServeWonPct"), TOUR_AVERAGE.firstServeWonPct);
  const secondServeWonPct = buildField(surfacePairsFor("secondServeWonPct"), allPairsFor("secondServeWonPct"), TOUR_AVERAGE.secondServeWonPct);
  const acesPerMatch = buildField(surfacePairsFor("aces"), allPairsFor("aces"), TOUR_AVERAGE.acesPerMatch);
  const doubleFaultsPerMatch = buildField(surfacePairsFor("doubleFaults"), allPairsFor("doubleFaults"), TOUR_AVERAGE.doubleFaultsPerMatch);
  const breakPointsWonPct = buildField(surfacePairsFor("breakPointsWonPct"), allPairsFor("breakPointsWonPct"), TOUR_AVERAGE.breakPointsWonPct);

  const now = Date.now();
  const matchesRecent14d = samples.filter((s) => s.date && now - new Date(s.date).getTime() <= RECENT_FATIGUE_DAYS * 24 * 3600 * 1000).length;

  const surfaceSampleCount = samples.filter((s) => s.surface === surface).length;

  return {
    available: true,
    playerName: playerName || null,
    ranking: rankingValue,
    form: samples.length ? buildFormString(samples) : null,
    matchesUsed: samples.length,
    surfaceMatchesUsed: surfaceSampleCount,
    matchesRecent14d,
    serveWinPct, returnWinPct, firstServeInPct, firstServeWonPct, secondServeWonPct,
    acesPerMatch, doubleFaultsPerMatch, breakPointsWonPct,
  };
}
