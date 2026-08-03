// Moteur de pronostics tennis — remplace l'ancien pronosticModel.js (11 blocs, bâti
// sur de vrais profils joueur : classement, forme, service/retour réels — voir
// lib/sports/tennis/statProfiles.js, supprimé). Live Tennis API (plan gratuit, voir
// lib/sports/tennis/provider.js) ne fournit ni historique de matchs ni statistiques de
// service/retour réelles : SEULES 4 lignes sont donc calculées désormais (voir
// PROMPT), à partir de ce qui est réellement disponible — le classement (GET /players/
// {id}, s'il est fourni) et le score EN COURS (GET /matches/{id}/score) :
//   1. Vainqueur du match (%)
//   2. Vainqueur du set en cours (%)
//   3. Total de jeux (Plus/Moins X,5)
//   4. Total de sets (Plus/Moins X,5)
// Réutilise TEL QUEL le moteur mathématique pur de lib/sports/tennis/matchModel.js
// (chaîne de Markov jeu -> set -> match, jamais dépendant de la source de données) :
// seule la façon de construire `modelState` change (classement plutôt que profil
// service/retour réel).
import {
  gameWinProb, simulateSetSymmetric, matchWinProbFromSetProb, expectedSetsPlayed,
  matchWinProbFromState, expectedAdditionalSetsFromState,
} from "./matchModel";
import { overUnderLine, round1 } from "../../pronostic";

// Taux moyen constaté sur le circuit professionnel de points gagnés au service
// (~62%) — base neutre quand le classement est inconnu pour un joueur ou les deux.
const BASE_POINT_ON_SERVE = 0.62;
const MAX_RANKING_ADJUSTMENT = 0.08;
const MIN_POINT_ON_SERVE = 0.35;
const MAX_POINT_ON_SERVE = 0.92;

// Écart de classement -> avantage au service, borné et jamais absolu : un très large
// écart (facteur ~20, ex. n°5 mondial vs n°100) donne l'ajustement maximal (±8 points),
// un classement manquant pour l'un ou l'autre joueur retombe sur 0 (aucune donnée
// inventée) — voir PROMPT : "à partir des données disponibles".
function rankingAdjustment(ownRanking, opponentRanking) {
  if (!Number.isFinite(ownRanking) || !Number.isFinite(opponentRanking) || ownRanking <= 0 || opponentRanking <= 0) return 0;
  const ratio = Math.log(opponentRanking / ownRanking);
  const normalized = Math.max(-1, Math.min(1, ratio / Math.log(20)));
  return normalized * MAX_RANKING_ADJUSTMENT;
}

function clampPointOnServe(p) {
  return Math.min(MAX_POINT_ON_SERVE, Math.max(MIN_POINT_ON_SERVE, p));
}

// Construit l'état du modèle pour CE match précis (jamais recopié d'un match à
// l'autre : dépend du classement réel des deux joueurs, quand connu) — `bestOf` :
// 5 uniquement si explicitement indiqué par l'appelant (Grand Chelem masculin),
// jamais deviné à partir d'un champ absent (voir pages/api/tennis/analyze.js).
export function buildModelState({ homeRanking = null, awayRanking = null, bestOf = 3 } = {}) {
  const p1PointOnServe = clampPointOnServe(BASE_POINT_ON_SERVE + rankingAdjustment(homeRanking, awayRanking));
  const p2PointOnServe = clampPointOnServe(BASE_POINT_ON_SERVE + rankingAdjustment(awayRanking, homeRanking));
  const p1Hold = gameWinProb(p1PointOnServe);
  const p2Hold = gameWinProb(p2PointOnServe);
  const setSim = simulateSetSymmetric(p1Hold, p2Hold, { p1PointOnServe, p2PointOnServe });
  return { p1Hold, p2Hold, p1PointOnServe, p2PointOnServe, pSet: setSim.p1WinProb, bestOf: bestOf === 5 ? 5 : 3 };
}

const TOTAL_SETS_LINE = { 3: 2.5, 5: 3.5 };

// `liveState` : null (ou un match pas encore commencé — 0-0 partout) pour le calcul
// AVANT match, sinon `{ setsWonHome, setsWonAway, currentSetGamesHome,
// currentSetGamesAway, gamesPlayedHome, gamesPlayedAway }` — voir
// deriveLiveSetsState ci-dessous, dérivé du vrai score par set renvoyé par l'API.
function isFreshState(liveState) {
  if (!liveState) return true;
  const { setsWonHome = 0, setsWonAway = 0, currentSetGamesHome = 0, currentSetGamesAway = 0 } = liveState;
  return setsWonHome === 0 && setsWonAway === 0 && currentSetGamesHome === 0 && currentSetGamesAway === 0;
}

export function computeLivePronostic({ modelState, liveState = null }) {
  const { p1Hold, p2Hold, p1PointOnServe, p2PointOnServe, pSet, bestOf } = modelState;
  const totalSetsLine = TOTAL_SETS_LINE[bestOf] || 2.5;

  if (isFreshState(liveState)) {
    const setSim = simulateSetSymmetric(p1Hold, p2Hold, { p1PointOnServe, p2PointOnServe });
    const matchWinProb = matchWinProbFromSetProb(pSet, bestOf);
    const eSets = expectedSetsPlayed(pSet, bestOf);
    return {
      probabilities: { home: round1(matchWinProb), away: round1(1 - matchWinProb) },
      currentSetProbabilities: { home: round1(setSim.p1WinProb), away: round1(1 - setSim.p1WinProb) },
      gameTotals: overUnderLine(eSets * setSim.expectedGames, { withMargin: true }),
      totalSets: { line: totalSetsLine, side: eSets > totalSetsLine ? "Plus" : "Moins" },
    };
  }

  const { setsWonHome = 0, setsWonAway = 0, currentSetGamesHome = 0, currentSetGamesAway = 0, gamesPlayedHome = 0, gamesPlayedAway = 0 } = liveState;

  const remaining = simulateSetSymmetric(p1Hold, p2Hold, {
    startG1: currentSetGamesHome, startG2: currentSetGamesAway, p1PointOnServe, p2PointOnServe,
  });
  const pWinCurrentSet = remaining.p1WinProb;

  const liveMatchWinProb =
    pWinCurrentSet * matchWinProbFromState(pSet, bestOf, setsWonHome + 1, setsWonAway) +
    (1 - pWinCurrentSet) * matchWinProbFromState(pSet, bestOf, setsWonHome, setsWonAway + 1);

  const additionalFutureSets =
    pWinCurrentSet * expectedAdditionalSetsFromState(pSet, bestOf, setsWonHome + 1, setsWonAway) +
    (1 - pWinCurrentSet) * expectedAdditionalSetsFromState(pSet, bestOf, setsWonHome, setsWonAway + 1);
  const freshSet = simulateSetSymmetric(p1Hold, p2Hold, { p1PointOnServe, p2PointOnServe });

  const totalGames = gamesPlayedHome + gamesPlayedAway + remaining.expectedGames + additionalFutureSets * freshSet.expectedGames;
  // Le set en cours compte pour 1 (il sera bien joué jusqu'au bout, même si déjà
  // entamé) + les sets déjà acquis + les sets futurs attendus au-delà de celui-ci.
  const totalSetsExpected = setsWonHome + setsWonAway + 1 + additionalFutureSets;

  return {
    probabilities: { home: round1(liveMatchWinProb), away: round1(1 - liveMatchWinProb) },
    currentSetProbabilities: { home: round1(pWinCurrentSet), away: round1(1 - pWinCurrentSet) },
    gameTotals: overUnderLine(totalGames, { withMargin: true }),
    totalSets: { line: totalSetsLine, side: totalSetsExpected > totalSetsLine ? "Plus" : "Moins" },
  };
}

// Un set est réellement TERMINÉ à 6 (ou plus) jeux avec 2 jeux d'écart, ou à 7-6/7-5
// (jeu décisif) — jamais déduit du simple fait qu'un joueur mène dans le set en cours.
function isSetComplete(s) {
  if (s?.home == null || s?.away == null) return false;
  const diff = Math.abs(s.home - s.away);
  if (Math.max(s.home, s.away) >= 6 && diff >= 2) return true;
  if (s.home === 7 || s.away === 7) return true;
  return false;
}

// Dérive l'état nécessaire à computeLivePronostic à partir du vrai score par set
// (voir lib/sports/tennis/mapper.js#mapLiveTennisMatch) — même logique que l'ancienne
// intégration (préservée telle quelle, indépendante de la source de données).
export function deriveLiveSetsState(sets) {
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

// Pool de sélections pour Combiné Vision (bloc 9, voir lib/combinedVision.js) — même
// forme générique que les autres sports : {marketLabel, pickLabel, confidence, reason,
// verify}. Pas d'aces (indisponibles sur ce plan, voir en-tête de fichier) ni de
// vainqueur du set en cours (métrique transitoire, non vérifiable après coup — voir
// lib/sports/tennis/pronosticHistory.js).
export function buildTennisSelectionCandidates({ probabilities, homeTeamName, awayTeamName, gameTotals, totalSets }) {
  const hName = homeTeamName || "Joueur 1";
  const aName = awayTeamName || "Joueur 2";
  const candidates = [];

  const winnerOptions = [
    { key: "home", pickLabel: `Victoire ${hName}`, confidence: probabilities.home },
    { key: "away", pickLabel: `Victoire ${aName}`, confidence: probabilities.away },
  ];
  const bestWinner = winnerOptions.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  candidates.push({
    marketLabel: "Issue du match", pickLabel: bestWinner.pickLabel, confidence: bestWinner.confidence,
    reason: null, verify: { type: "winner", key: bestWinner.key },
  });

  if (gameTotals?.line != null && gameTotals?.side) {
    candidates.push({
      marketLabel: "Total jeux", pickLabel: `${gameTotals.side} de ${String(gameTotals.line).replace(".", ",")}`,
      confidence: gameTotals.confidence ?? 60, reason: null,
      verify: { type: "line", statKey: "totalGames", line: gameTotals.line, side: gameTotals.side },
    });
  }

  if (totalSets?.line != null && totalSets?.side) {
    candidates.push({
      marketLabel: "Total sets", pickLabel: `${totalSets.side} de ${String(totalSets.line).replace(".", ",")}`,
      confidence: 60, reason: null,
      verify: { type: "line", statKey: "totalSets", line: totalSets.line, side: totalSets.side },
    });
  }

  return candidates;
}
