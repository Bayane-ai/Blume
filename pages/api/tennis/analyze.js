// Bloc 7 (pronostics tennis) — équivalent tennis de pages/api/analyze.js (football)
// et pages/api/basketball/analyze.js : croise les profils réels des deux joueurs
// (lib/sports/tennis/statProfiles.js) pour produire toutes les lignes de pronostic
// (lib/sports/tennis/pronosticModel.js), puis recalcule EN DIRECT uniquement la
// probabilité de victoire, les scores en sets probables et les totaux de jeux — le
// reste (aces/doubles fautes/breaks/tie-break/handicap) reste figé (voir PROMPT,
// "Règle figé/live").
//
// Bloc 8 : FIGE le pronostic une seule fois (lib/sports/tennis/pronosticHistory.js —
// même table Supabase que le football/basket, sport='tennis') et le vérifie
// automatiquement ligne par ligne dès que le match est constaté terminé, plus la
// timeline "Moments forts" (lib/sports/tennis/timeline.js), reconstruite à partir du
// vrai score par set/par jeu — jamais "Événement non disponible".
import { getTennisApiKey, getGameById, getGameStatistics, getHeadToHead } from "../../../lib/sports/tennis/provider";
import { mapMatchToLiveState, mapGameStatistics } from "../../../lib/sports/tennis/mapper";
import { getOrBuildPlayerProfile } from "../../../lib/sports/tennis/statProfiles";
import { computeTennisPronostic, computeTennisLiveOverlay } from "../../../lib/sports/tennis/pronosticModel";
import { recordSnapshotAndBuildTimeline, TIMELINE_LIMITATION_NOTE } from "../../../lib/sports/tennis/timeline";
import {
  getFrozenPrediction, saveFrozenPrediction, verifyFrozenPrediction, canPersistMatch,
} from "../../../lib/sports/tennis/pronosticHistory";

// Les ids transmis par components/MatchCard.js#matchHref portent le préfixe "tn-"
// (voir lib/sports/tennis/mapper.js) — jamais envoyés tels quels à l'API, qui attend
// ses propres ids numériques.
function stripPrefix(id) {
  if (typeof id !== "string") return null;
  const n = id.startsWith("tn-") ? id.slice(3) : id;
  return n || null;
}

// Grand Chelem masculin = 5 sets gagnants ; tout le reste (ATP hors Grand Chelem,
// WTA y compris ses propres Grands Chelems) = 3 — voir PROMPT. La forme exacte du
// champ "catégorie" renvoyé par API-Tennis n'a pas pu être vérifiée en direct depuis
// cet environnement (réseau bloqué, voir lib/sports/tennis/provider.js) : détection
// par mot-clé, robuste à une variante de casse, plutôt qu'une correspondance exacte
// fragile — même principe que mapMatchStatusToBlumeStatus.
function determineBestOf(category) {
  const text = (category || "").toLowerCase();
  const isGrandSlam = /grand\s*slam|grand\s*chelem/.test(text);
  const isWTA = /wta/.test(text);
  return isGrandSlam && !isWTA ? 5 : 3;
}

// Un set est réellement TERMINÉ à 6 (ou plus) jeux avec 2 jeux d'écart, ou à 7-6/7-5
// (jeu décisif ou break au 12e jeu) — jamais déduit du simple fait qu'un joueur mène
// actuellement dans le set en cours (voir lib/sports/tennis/mapper.js#computeSetsWon,
// dont le repli par set peut à tort compter un set encore en cours comme déjà gagné
// par celui qui mène : cette fonction-ci, plus stricte, sert spécifiquement à séparer
// les sets vraiment finis du set en cours pour le recalcul en direct ci-dessous).
function isSetComplete(s) {
  if (s?.home == null || s?.away == null) return false;
  const diff = Math.abs(s.home - s.away);
  if (Math.max(s.home, s.away) >= 6 && diff >= 2) return true;
  if (s.home === 7 || s.away === 7) return true;
  return false;
}

function deriveLiveSetsState(sets) {
  let setsWonHome = 0;
  let setsWonAway = 0;
  let gamesPlayedHome = 0;
  let gamesPlayedAway = 0;
  let currentSetGamesHome = 0;
  let currentSetGamesAway = 0;
  for (const s of sets || []) {
    if (s?.home == null && s?.away == null) continue;
    const h = s.home ?? 0;
    const a = s.away ?? 0;
    gamesPlayedHome += h;
    gamesPlayedAway += a;
    if (isSetComplete(s)) {
      if (h > a) setsWonHome += 1;
      else if (a > h) setsWonAway += 1;
    } else {
      currentSetGamesHome = h;
      currentSetGamesAway = a;
    }
  }
  return { setsWonHome, setsWonAway, currentSetGamesHome, currentSetGamesAway, gamesPlayedHome, gamesPlayedAway };
}

// Statistiques agrégées du match (source de secours pour "balles de break sauvées"
// dans la timeline, voir lib/sports/tennis/timeline.js) — jamais une exception qui
// interromprait l'analyse si cette source échoue ou n'est pas encore disponible.
async function fetchGameStatsSafe(gameId, apiKey, game) {
  try {
    const raw = await getGameStatistics(gameId, apiKey);
    const homeId = game?.teams?.home?.id ?? game?.players?.home?.id ?? null;
    return mapGameStatistics(raw, homeId);
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  const apiKey = getTennisApiKey();
  if (!apiKey) return res.status(500).json({ available: false, error: "Clé API tennis manquante" });

  const { matchId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, surface, category } = req.query;
  const realMatchId = stripPrefix(matchId);
  const realHomeId = stripPrefix(homeTeamId);
  const realAwayId = stripPrefix(awayTeamId);
  if (!realHomeId || !realAwayId) {
    return res.status(400).json({ available: false, error: "Paramètres manquants (identifiants de joueur)" });
  }

  try {
    const bestOf = determineBestOf(category);

    // Le score/l'état du match viennent toujours de l'API, jamais d'une valeur
    // transmise par le client (même principe que pages/api/analyze.js et pages/api/
    // basketball/analyze.js) — lu une seule fois, avant même de savoir si un
    // pronostic figé existe déjà pour ce match.
    const game = realMatchId ? await getGameById(realMatchId, apiKey) : null;
    const liveMatch = game ? mapMatchToLiveState(game) : null;
    const status = liveMatch?.status || "SCHEDULED";
    const isLive = status === "IN_PLAY" || status === "PAUSED";
    const finalScore = liveMatch?.score?.fullTime || null;

    // PRONOSTIC FIGÉ (bloc 8) : calculé une seule fois à la première analyse de CE
    // match, jamais recalculé ensuite (voir lib/sports/tennis/pronosticHistory.js).
    let result;
    const frozen = await getFrozenPrediction(matchId);
    if (frozen) {
      result = { available: true, ...frozen.prediction };
      if (frozen.status === "success" || frozen.status === "failure") result.historyStatus = frozen.status;
    } else {
      // Profils réels des deux joueurs (classement, forme, surface, service/retour,
      // fatigue — voir lib/sports/tennis/statProfiles.js) et confrontations directes
      // réelles, en parallèle — seulement calculés quand aucun pronostic n'est déjà
      // figé pour ce match.
      const [homeProfile, awayProfile, h2hGames] = await Promise.all([
        getOrBuildPlayerProfile({ playerId: realHomeId, playerName: homeTeamName, surface: surface || null, apiKey }),
        getOrBuildPlayerProfile({ playerId: realAwayId, playerName: awayTeamName, surface: surface || null, apiKey }),
        getHeadToHead(realHomeId, realAwayId, apiKey),
      ]);
      result = computeTennisPronostic({
        homeProfile, awayProfile, homeTeamName, awayTeamName,
        h2hGames, homeId: realHomeId, bestOf, surface: surface || null,
      });
      if (result.available && canPersistMatch(matchId) && homeTeamName && awayTeamName) {
        const justClassified = await saveFrozenPrediction({
          matchId, homeTeamName, awayTeamName, matchDate: game?.date || null,
          result, matchStatus: status, finalScore, game, apiKey,
        });
        if (justClassified) result = { ...result, ...justClassified.prediction, historyStatus: justClassified.status };
      }
    }

    if (!result.available) return res.status(200).json(result);

    // RECALCUL EN DIRECT (voir PROMPT, "Règle figé/live") : UNIQUEMENT probabilité de
    // victoire, scores en sets probables et totaux de jeux — jamais aces/doubles
    // fautes/breaks/tie-break/handicap, qui restent ceux calculés ci-dessus, figés.
    if (isLive) {
      const liveState = deriveLiveSetsState(liveMatch.sets || []);
      const overlay = computeTennisLiveOverlay({ modelState: result.modelState, bestOf, liveState });
      result.probabilities = overlay.probabilities;
      result.setScores = overlay.setScores;
      result.gameTotals = overlay.gameTotals;
    }

    result.matchStatus = status;
    result.matchScore = finalScore;
    // Score du jeu en cours ("40-30") et numéro du set en cours ("Set 3") — comme pour
    // la carte (voir components/MatchInfoBlock.js/lib/liveClockFormat.js), affichés
    // tels quels dans l'en-tête du match pendant qu'il est suivi en direct.
    result.matchMinute = liveMatch?.minute || null;
    result.matchPeriod = liveMatch?.period || null;
    // Score détaillé set par set (bloc 8, point 1 : "sets terminés") — vient toujours
    // de l'API en direct, jamais figé au clic depuis la liste (voir pages/match/[id].js,
    // qui ne dispose sinon que de l'instantané pris au moment du clic).
    result.sets = liveMatch?.sets && liveMatch.sets.length > 0 ? liveMatch.sets : null;
    // Joueur au service (bloc 8, point 1 : "indicateur du joueur au service" dans
    // l'en-tête détaillé de la page de match) — absent des champs déjà renvoyés par
    // cette route jusqu'ici (seule la carte de liste, alimentée directement par
    // /api/tennis/live-matches, l'affichait).
    result.server = liveMatch?.server || null;
    result.live = Boolean(isLive);

    // "Moments forts" (bloc 8, point 1) : TOUJOURS rempli une fois le match connu
    // (jamais "Événement non disponible") — reconstruit à partir du VRAI score par
    // set/par jeu, voir lib/sports/tennis/timeline.js pour ce qui est réellement
    // dérivable (et la source de secours utilisée pour les balles de break sauvées).
    if (realMatchId && liveMatch) {
      const gameStats = await fetchGameStatsSafe(realMatchId, apiKey, game);
      result.events = recordSnapshotAndBuildTimeline(realMatchId, liveMatch, gameStats, { homeTeamName, awayTeamName });
    } else {
      result.events = [];
    }
    result.timelineNote = TIMELINE_LIMITATION_NOTE;

    // Compte-rendu de fin de match (bloc 8) : dès que le match est constaté
    // "FINISHED", compare le pronostic FIGÉ (jamais un nouveau calcul) au vrai
    // résultat pour classer Succès/Échec (probabilité de victoire) et vérifier chaque
    // ligne — automatique, sans action de l'utilisateur. Idempotent.
    if (status === "FINISHED" && canPersistMatch(matchId) && !result.historyStatus) {
      try {
        const justVerified = await verifyFrozenPrediction(matchId, finalScore, game, apiKey);
        if (justVerified) result = { ...result, ...justVerified.prediction, historyStatus: justVerified.status };
      } catch (e) {
        console.error("Erreur compte-rendu de fin de match (tennis):", e.message);
      }
    }

    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=20");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ available: false, error: e.message });
  }
}
