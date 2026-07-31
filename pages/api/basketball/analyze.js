// Bloc 3/4 (multi-sport) — équivalent basket de pages/api/analyze.js : croise les
// profils réels des deux équipes (lib/sports/basketball/statProfiles.js) pour
// produire toutes les lignes de pronostic (lib/sports/basketball/pronosticModel.js),
// le bloc "Joueurs à suivre" (lib/sports/basketball/playerProps.js) et la timeline
// "Moments forts" (lib/sports/basketball/timeline.js), puis FIGE le pronostic une
// seule fois (lib/sports/basketball/pronosticHistory.js — même table Supabase que le
// football, sport='basketball') et le vérifie automatiquement ligne par ligne dès que
// le match est constaté terminé.
import { getBasketballApiKey, getGameById, getTeamPlayerStatistics } from "../../../lib/sports/basketball/provider";
import { mapGameStatusToBlumeStatus } from "../../../lib/sports/basketball/mapper";
import { getOrRefreshTeamProfile } from "../../../lib/sports/basketball/statProfiles";
import { computeBasketballPronostic, computeBasketballLiveOverlay, winProbabilityReason } from "../../../lib/sports/basketball/pronosticModel";
import { buildPlayerProps } from "../../../lib/sports/basketball/playerProps";
import { recordSnapshotAndBuildTimeline, TIMELINE_LIMITATION_NOTE } from "../../../lib/sports/basketball/timeline";
import {
  getFrozenPrediction, saveFrozenPrediction, verifyFrozenPrediction, canPersistMatch,
} from "../../../lib/sports/basketball/pronosticHistory";

// Les ids transmis par components/MatchCard.js#matchHref portent le préfixe "bk-"
// (voir lib/sports/basketball/mapper.js) — jamais envoyés tels quels à l'API, qui
// attend ses propres ids numériques.
function stripPrefix(id) {
  if (typeof id !== "string") return null;
  const n = id.startsWith("bk-") ? id.slice(3) : id;
  return n || null;
}

const QUARTER_KEYS = ["quarter_1", "quarter_2", "quarter_3", "quarter_4"];

// Fraction du match RESTANT à jouer, utilisée par computeBasketballLiveOverlay pour
// faire suivre probabilité/scores/totaux au score réel en cours (voir PROMPT bloc 4,
// règle figé/live). Le chrono officiel (`status.timer`) est un compte à rebours dans
// le quart-temps courant, mais sa durée totale varie selon la ligue (12 min en NBA,
// 10 min FIBA...) — plutôt que de supposer une durée, on se base sur le nombre de
// quart-temps DÉJÀ complets (leurs scores sont renseignés dans `game.scores`), une
// donnée fiable quelle que soit la ligue : un repère plus grossier, mais jamais faux.
// Un quart-temps en cours compte pour une moitié de sa part (approximation honnête du
// "milieu de quart-temps" faute de mieux).
function computeRemainingFraction(game, status) {
  const home = game?.scores?.home || {};
  const quartersCompleted = QUARTER_KEYS.filter((k) => Number.isFinite(home[k])).length;
  if (status === "PAUSED") {
    return Math.max(0.03, 1 - quartersCompleted / 4);
  }
  if (status === "IN_PLAY") {
    if (game?.status?.short === "OT") return 0.05;
    const elapsed = Math.min(0.97, quartersCompleted / 4 + 0.125);
    return Math.max(0.03, 1 - elapsed);
  }
  return 1;
}

// Calcule le pronostic COMPLET une seule fois — jamais à partir du score en direct —
// pour un match qui n'a pas encore de pronostic figé (voir pages/api/analyze.js pour
// l'équivalent football, computeFreshPrediction). Renvoie `{ available:false, ... }`
// tel quel si un profil manque.
async function computeFreshPrediction({ homeTeamId, awayTeamId, homeTeamName, awayTeamName, season, apiKey }) {
  const [homeProfile, awayProfile, homePlayers, awayPlayers] = await Promise.all([
    getOrRefreshTeamProfile({ teamId: homeTeamId, teamName: homeTeamName, season, apiKey }),
    getOrRefreshTeamProfile({ teamId: awayTeamId, teamName: awayTeamName, season, apiKey }),
    getTeamPlayerStatistics({ team: homeTeamId, season }, apiKey),
    getTeamPlayerStatistics({ team: awayTeamId, season }, apiKey),
  ]);
  if (!homeProfile.available || !awayProfile.available) {
    return { available: false, reason: !homeProfile.available ? homeProfile.reason : awayProfile.reason };
  }
  const result = computeBasketballPronostic({ homeProfile, awayProfile, homeTeamName, awayTeamName });
  if (!result.available) return result;
  result.players = buildPlayerProps({ homeRows: homePlayers, awayRows: awayPlayers });
  return result;
}

export default async function handler(req, res) {
  const apiKey = getBasketballApiKey();
  if (!apiKey) return res.status(500).json({ available: false, error: "Clé API basket manquante" });

  const { matchId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, season: seasonParam } = req.query;
  const realMatchId = stripPrefix(matchId);
  const realHomeTeamId = stripPrefix(homeTeamId);
  const realAwayTeamId = stripPrefix(awayTeamId);
  if (!realHomeTeamId || !realAwayTeamId) {
    return res.status(400).json({ available: false, error: "Paramètres manquants (identifiants d'équipe)" });
  }

  try {
    // Le score/le quart-temps/le chrono viennent toujours de l'API, jamais d'une
    // valeur transmise par le client — mis en cache quelques secondes (voir
    // lib/sports/basketball/provider.js) pour mutualiser les appels entre plusieurs
    // visiteurs qui suivent le même match en même temps.
    const game = realMatchId ? await getGameById(realMatchId, apiKey) : null;
    // La saison vient normalement de l'URL (voir components/MatchCard.js#matchHref) ;
    // repli sur celle du match lui-même si elle manque, jamais une saison devinée.
    const season = seasonParam || (game?.league?.season != null ? String(game.league.season) : null);
    if (!season) {
      return res.status(200).json({ available: false, reason: "saison introuvable pour ce match" });
    }

    const status = game ? mapGameStatusToBlumeStatus(game.status?.short) : "SCHEDULED";
    const isLive = status === "IN_PLAY" || status === "PAUSED";
    const finalScore = game ? { home: game.scores?.home?.total ?? null, away: game.scores?.away?.total ?? null } : null;

    // PRONOSTIC FIGÉ (bloc 4) : calculé une seule fois à la première analyse de CE
    // match, jamais recalculé ensuite (voir lib/sports/basketball/pronosticHistory.js).
    // Un pronostic déjà figé est relu tel quel — SAUF probabilité/scores finaux/
    // totaux de points, qui suivent bien l'évolution réelle du match (recalcul plus
    // bas, jamais persisté).
    let result;
    const frozen = await getFrozenPrediction(matchId);
    if (frozen) {
      result = { available: true, ...frozen.prediction };
      if (frozen.status === "success" || frozen.status === "failure") result.historyStatus = frozen.status;
    } else {
      result = await computeFreshPrediction({
        homeTeamId: realHomeTeamId, awayTeamId: realAwayTeamId, homeTeamName, awayTeamName, season, apiKey,
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

    // RECALCUL EN DIRECT (bloc 4, PROMPT) : UNIQUEMENT probabilité de victoire, scores
    // finaux probables et totaux de points — jamais recalculé à partir des profils
    // d'équipe (voir computeBasketballLiveOverlay), toujours à partir des lambdas/
    // écarts-types déjà FIGÉS (result.goals/result.sdHome/result.sdAway, présents
    // aussi bien pour un pronostic tout juste calculé que pour un pronostic relu figé).
    if (isLive) {
      const liveOffset = {
        home: finalScore.home ?? 0,
        away: finalScore.away ?? 0,
        remainingFraction: computeRemainingFraction(game, status),
      };
      const overlay = computeBasketballLiveOverlay({
        lambdaHome: result.goals.expectedHome, lambdaAway: result.goals.expectedAway,
        sdHome: result.sdHome, sdAway: result.sdAway, liveOffset,
      });
      result.probabilities = overlay.probabilities;
      result.goals = overlay.goals;
      result.correctScores = overlay.correctScores;
      result.markets = { ...result.markets, ...overlay.markets };
      result.narrative = {
        ...result.narrative,
        winProbability: winProbabilityReason(overlay.probabilities, overlay.goals.expectedHome, overlay.goals.expectedAway, result.home?.name, result.away?.name),
      };
    }

    // "Par période" (PROMPT bloc 3, précisé bloc 4) : le libellé bascule de "1ère
    // mi-temps" à "2ème mi-temps" dès que 2 quart-temps sont déjà complets (ou le
    // match terminé) — jamais avant. La ligne FIGÉE elle-même (firstHalfTotal/
    // secondHalfTotal) ne change jamais : seul l'affichage choisit laquelle montrer.
    const homeScores = game?.scores?.home || {};
    const quartersCompleted = QUARTER_KEYS.filter((k) => Number.isFinite(homeScores[k])).length;
    const firstHalfOver = status === "FINISHED" || quartersCompleted >= 2;
    if (result.periods) {
      result.periods = {
        ...result.periods,
        activeHalfLabel: firstHalfOver ? "Total 2ème mi-temps" : "Total 1ère mi-temps",
        activeHalf: firstHalfOver ? result.periods.secondHalf : result.periods.firstHalf,
      };
    }

    result.matchStatus = status;
    result.matchScore = finalScore;
    result.live = isLive;

    // "Moments forts" (bloc 4, PROMPT) : TOUJOURS rempli une fois le match commencé
    // (jamais "Événement non disponible") — reconstruit à partir du VRAI score
    // officiel, voir lib/sports/basketball/timeline.js pour ce qui est réellement
    // dérivable (et ce qui ne l'est pas, faute de play-by-play côté API-Basketball).
    result.events = realMatchId && game ? recordSnapshotAndBuildTimeline(realMatchId, game, { homeTeamName, awayTeamName }) : [];
    result.timelineNote = TIMELINE_LIMITATION_NOTE;

    // Compte-rendu de fin de match (bloc 4) : dès que le match est constaté
    // "FINISHED", compare le pronostic FIGÉ (jamais un nouveau calcul) au vrai
    // résultat pour classer Succès/Échec, ligne par ligne — automatique, sans action
    // de l'utilisateur. Idempotent : ne fait rien si déjà classé.
    if (status === "FINISHED" && canPersistMatch(matchId) && !result.historyStatus) {
      try {
        const justVerified = await verifyFrozenPrediction(matchId, finalScore, game, apiKey);
        if (justVerified) result = { ...result, ...justVerified.prediction, historyStatus: justVerified.status };
      } catch (e) {
        console.error("Erreur compte-rendu de fin de match (basket):", e.message);
      }
    }

    res.setHeader("Cache-Control", "s-maxage=3, stale-while-revalidate=20");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ available: false, error: e.message });
  }
}
