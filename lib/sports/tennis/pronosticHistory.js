import { supabaseAnon as supabase } from "../../supabaseAnon";
import { getGameById, getGameStatistics, getTennisApiKey } from "./provider";
import { mapMatchToLiveState, mapGameStatistics } from "./mapper";

// Bloc 8 (multi-sport, tennis) — équivalent tennis de lib/sports/basketball/
// pronosticHistory.js : même table Supabase pronostic_history (voir supabase/
// migrations/0002_pronostic_history.sql et 0014_pronostic_history_sport_column.sql),
// simplement `sport: "tennis"` et des lignes de vérification propres au tennis
// (scores en sets, totaux/handicap de jeux, sets, aces, doubles fautes, jeu décisif —
// jamais de corners/cartons/rebonds). L'id RÉEL du match (`tn-<id>`) est toujours
// connu : la vérification finale relit directement CE match précis (getGameById/
// getGameStatistics), jamais une correspondance approximative (comme le basket, et
// contrairement au football pour ses matchs `af-`).
//
// RÈGLE DE CLASSEMENT (PROMPT bloc 8, explicitement différente du football/basket qui
// utilisent la MAJORITÉ de toutes les lignes vérifiables) : "Probabilité de victoire :
// joueur prédit gagnant qui gagne → Succès, sinon → Échec." — la case Succès/Échec
// (donc l'onglet Tennis de Probabilités réussies/échouées) suit UNIQUEMENT cette ligne
// précise. Toutes les AUTRES lignes (scores en sets, totaux de jeux, handicap, sets,
// aces, doubles fautes, jeu décisif) reçoivent quand même leur propre crochet vert/
// croix rouge individuel (PROMPT : "validation automatique, ligne par ligne") — elles
// sont affichées mais ne pèsent jamais dans le classement global.

const EXPIRY_DAYS = 5;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;
const PENDING_REVALIDATE_LIMIT = 15;
const SPORT = "tennis";
const SET_KEYS = ["set_1", "set_2", "set_3", "set_4", "set_5"];

// Un match tennis est TOUJOURS identifié par un id "tn-..." (voir lib/sports/tennis/
// mapper.js) — jamais l'inverse, donc jamais besoin d'un repli "impossible à
// persister" comme côté football.
export function canPersistMatch(matchId) {
  return Boolean(matchId) && String(matchId).startsWith("tn-");
}

function realGameId(matchId) {
  return String(matchId).replace(/^tn-/, "");
}

// Ne garde du pronostic complet que ce qui relève vraiment d'une PRÉDICTION — jamais
// les champs live éphémères (matchStatus/matchScore/matchMinute/matchPeriod/server/
// live/events/timelineNote/available), réappliqués par-dessus le pronostic figé (voir
// pages/api/tennis/analyze.js). `modelState` EST conservé : c'est lui qui permet au
// recalcul en direct de reprendre sans revenir chercher les profils de joueur (voir
// lib/sports/tennis/pronosticModel.js#computeTennisLiveOverlay).
export function toPredictionSnapshot(result) {
  if (!result) return null;
  const {
    home, away, bestOf, surface, probabilities, setScores, gameTotals, gameHandicap,
    setsBlock, aces, doubleFaults, breaks, tiebreak, serviceReturnContext, narrative,
    h2hUsed, h2hSummary, note, modelState,
  } = result;
  return {
    home, away, bestOf, surface, probabilities, setScores, gameTotals, gameHandicap,
    setsBlock, aces, doubleFaults, breaks, tiebreak, serviceReturnContext, narrative,
    h2hUsed, h2hSummary, note, modelState,
  };
}

// Tennis : jamais de match nul (voir lib/sports/tennis/pronosticModel.js) — le joueur
// favori désigné avant match est simplement celui dont la probabilité de victoire est
// la plus haute. C'EST cette comparaison, et uniquement elle, qui détermine le
// classement Succès/Échec du match (voir en-tête de fichier).
export function classifyOutcome(prediction, finalScore) {
  const home = Number(finalScore?.home);
  const away = Number(finalScore?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away) || home === away) return null;
  const probs = prediction?.probabilities;
  if (!probs) return null;
  const predictedOutcome = probs.home >= probs.away ? "home" : "away";
  const actualOutcome = home > away ? "home" : "away";
  return predictedOutcome === actualOutcome ? "success" : "failure";
}

// Ligne "Plus/Moins de X,5" comparée au vrai chiffre — `true`/`false`/`null` (donnée
// manquante, jamais un crochet/une croix inventés) — même helper que le basket.
function verifyLine(market, realValue) {
  if (!market?.available || market.line == null || !market.side) return null;
  if (realValue == null || !Number.isFinite(realValue)) return null;
  return market.side === "Plus" ? realValue > market.line : realValue < market.line;
}

function verifyRiskLines(market, realValue) {
  if (!market) return { safe: null, risky: null };
  return { safe: verifyLine(market.safe, realValue), risky: verifyLine(market.risky, realValue) };
}

function verifyStatBlock(block, realHome, realAway) {
  const realTotal = Number.isFinite(realHome) && Number.isFinite(realAway) ? realHome + realAway : null;
  return {
    total: verifyLine(block?.total, realTotal),
    home: verifyLine(block?.home, realHome),
    away: verifyLine(block?.away, realAway),
  };
}

// Ligne "{line, side}" simple (pas l'objet `{available, ...}` de lib/pronostic.js) —
// utilisée pour setsBlock.totalSets, qui est construite à la main dans
// pronosticModel.js sans passer par overUnderLine.
function verifySimpleLine(lineObj, realValue) {
  if (!lineObj || lineObj.line == null || !lineObj.side || realValue == null || !Number.isFinite(realValue)) return null;
  return lineObj.side === "Plus" ? realValue > lineObj.line : realValue < lineObj.line;
}

function verifyYesNo(predictedYesNo, realBoolean) {
  if (predictedYesNo == null || realBoolean == null) return null;
  return (predictedYesNo === "Oui") === realBoolean;
}

function verifySide(predictedSide, realSide) {
  if (!predictedSide || !realSide) return null;
  return predictedSide === realSide;
}

// Scores en sets probables : validés si L'UN des scores prédits correspond EXACTEMENT
// au score final réel (déjà au format "home-away", voir pronosticModel.js#setScores).
function verifySetScoresLine(setScores, finalScore) {
  const home = Number(finalScore?.home);
  const away = Number(finalScore?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (!Array.isArray(setScores) || setScores.length === 0) return null;
  return setScores.some((s) => s.score === `${home}-${away}`);
}

// Vrai score par set (game.scores.home/away.set_N) — même convention que
// lib/sports/tennis/pronosticModel.js#matchWinnerIsHome, jamais un recalcul inventé.
function realSetsFromGame(game) {
  const home = game?.scores?.home || {};
  const away = game?.scores?.away || {};
  const sets = [];
  for (const key of SET_KEYS) {
    const h = home[key];
    const a = away[key];
    if (typeof h !== "number" || typeof a !== "number") continue;
    sets.push({ home: h, away: a });
  }
  return sets;
}

function realGameTotals(sets) {
  let home = 0;
  let away = 0;
  let any = false;
  for (const s of sets) {
    if (Number.isFinite(s.home) && Number.isFinite(s.away)) {
      home += s.home;
      away += s.away;
      any = true;
    }
  }
  return any ? { home, away, total: home + away } : { home: null, away: null, total: null };
}

function realTiebreakOccurred(sets) {
  if (!sets.length) return null;
  return sets.some((s) => (s.home === 7 && s.away === 6) || (s.home === 6 && s.away === 7));
}

// Vraies statistiques finales de CE match précis (aces, doubles fautes) — via l'id
// RÉEL déjà connu du match. `null` en silence si la clé API manque, si la source
// échoue, ou si les données ne sont pas exploitables — jamais une exception qui
// interromprait la vérification (les lignes de jeux/sets restent vérifiables via le
// vrai score par set, toujours connu).
async function fetchRealFinalStats(game, apiKey) {
  if (!game?.id || !apiKey) return null;
  try {
    const raw = await getGameStatistics(game.id, apiKey);
    const homeId = game?.teams?.home?.id ?? game?.players?.home?.id ?? null;
    return mapGameStatistics(raw, homeId);
  } catch (e) {
    console.error("Erreur récupération statistiques finales (tennis):", e.message);
    return null;
  }
}

// Classe le pronostic FIGÉ contre le vrai résultat : compare CHAQUE ligne
// individuellement (affichage ligne par ligne, voir components/TennisVerifiedLines.js),
// puis classe Succès/Échec du match SEULEMENT sur la probabilité de victoire (voir
// en-tête de fichier — règle explicite du bloc 8, différente du football/basket).
async function classifyAndVerify({ prediction, finalScore, game, apiKey }) {
  const sets = realSetsFromGame(game);
  const totals = realGameTotals(sets);
  const stats = await fetchRealFinalStats(game, apiKey);
  const first = sets[0] || null;
  const firstSetGamesReal = first && Number.isFinite(first.home) && Number.isFinite(first.away) ? first.home + first.away : null;
  const firstSetWinnerReal = first && Number.isFinite(first.home) && Number.isFinite(first.away)
    ? (first.home > first.away ? "home" : first.away > first.home ? "away" : null)
    : null;
  const hasFinalScore = Number.isFinite(Number(finalScore?.home)) && Number.isFinite(Number(finalScore?.away));
  const bothWinASetReal = hasFinalScore ? (Number(finalScore.home) >= 1 && Number(finalScore.away) >= 1) : null;
  const gameDiffReal = totals.home != null && totals.away != null ? Math.abs(totals.home - totals.away) : null;
  const tiebreakReal = realTiebreakOccurred(sets);

  const outcome = classifyOutcome(prediction, finalScore);
  const verification = {
    winner: outcome == null ? null : outcome === "success",
    correctScores: verifySetScoresLine(prediction?.setScores, finalScore),
    totalGames: verifyLine(prediction?.gameTotals?.total, totals.total),
    totalGamesHome: verifyLine(prediction?.gameTotals?.home, totals.home),
    totalGamesAway: verifyLine(prediction?.gameTotals?.away, totals.away),
    gameHandicap: gameDiffReal != null ? verifyRiskLines(prediction?.gameHandicap, gameDiffReal) : { safe: null, risky: null },
    totalSets: verifySimpleLine(prediction?.setsBlock?.totalSets, sets.length > 0 ? sets.length : null),
    bothWinASet: verifyYesNo(prediction?.setsBlock?.bothWinASet, bothWinASetReal),
    firstSetWinner: verifySide(prediction?.setsBlock?.firstSetWinner, firstSetWinnerReal),
    firstSetGames: verifyLine(prediction?.setsBlock?.firstSetGames, firstSetGamesReal),
    aces: verifyStatBlock(prediction?.aces, stats?.home?.aces?.value, stats?.away?.aces?.value),
    doubleFaults: verifyStatBlock(prediction?.doubleFaults, stats?.home?.doubleFaults?.value, stats?.away?.doubleFaults?.value),
    // Breaks : jamais vérifiés — aucune source connectée à Blume ne fournit un
    // décompte réel et fiable du nombre TOTAL de breaks d'un match (seul le nombre de
    // balles de break GAGNÉES par le relanceur est disponible, voir statistiques
    // agrégées — pas le nombre de jeux de service effectivement perdus) —
    // "Indisponible" plutôt qu'un chiffre approximatif présenté comme une vérité.
    breaks: { total: null, home: null, away: null },
    tiebreak: verifyYesNo(prediction?.tiebreak?.likely, tiebreakReal),
  };
  const status = outcome || "pending";
  return { status, prediction: { ...prediction, verification } };
}

// Relit le pronostic déjà figé pour CE match, s'il existe — jamais un nouveau calcul.
export async function getFrozenPrediction(matchId) {
  if (!canPersistMatch(matchId)) return null;
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("prediction, status, final_score")
      .eq("match_id", String(matchId))
      .maybeSingle();
    if (error) {
      console.error("Erreur lecture pronostic figé (tennis):", error.message);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error("Erreur lecture pronostic figé (tennis):", e.message);
    return null;
  }
}

// Fige le pronostic d'un match analysé pour la PREMIÈRE fois — upsert avec
// ignoreDuplicates (un appel concurrent ne peut jamais écraser). Si le match est déjà
// terminé au moment de cette toute première analyse, le classe directement au lieu de
// rester "pending" pour rien.
export async function saveFrozenPrediction({ matchId, homeTeamName, awayTeamName, matchDate, result, matchStatus, finalScore, game, apiKey }) {
  if (!canPersistMatch(matchId) || !homeTeamName || !awayTeamName) return;
  const snapshot = toPredictionSnapshot(result);
  if (!snapshot) return;

  try {
    const isFinished = matchStatus === "FINISHED";
    let status = "pending";
    let predictionToSave = snapshot;
    if (isFinished) {
      const classified = await classifyAndVerify({ prediction: snapshot, finalScore, game, apiKey });
      status = classified.status;
      predictionToSave = classified.prediction;
    }
    const { error } = await supabase.from("pronostic_history").upsert(
      {
        match_id: String(matchId),
        sport: SPORT,
        competition_code: null,
        home_team_name: homeTeamName,
        away_team_name: awayTeamName,
        match_date: matchDate || null,
        prediction: predictionToSave,
        status,
        final_score: isFinished ? finalScore : null,
        verified_at: isFinished ? new Date().toISOString() : null,
      },
      { onConflict: "match_id", ignoreDuplicates: true }
    );
    if (error) console.error("Erreur sauvegarde pronostic figé (tennis):", error.message);
    else if (isFinished) return { status, prediction: predictionToSave };
  } catch (e) {
    console.error("Erreur sauvegarde pronostic figé (tennis):", e.message);
  }
}

// Compte-rendu de fin de match : compare le pronostic FIGÉ (jamais un recalcul) au
// vrai résultat, classe Succès/Échec — idempotent (ne fait rien si déjà classé).
export async function verifyFrozenPrediction(matchId, finalScore, game, apiKey) {
  if (!canPersistMatch(matchId)) return;
  try {
    const { data: pendingRow, error: selectError } = await supabase
      .from("pronostic_history")
      .select("prediction")
      .eq("match_id", String(matchId))
      .eq("status", "pending")
      .maybeSingle();
    if (selectError || !pendingRow) return;

    const { status, prediction } = await classifyAndVerify({ prediction: pendingRow.prediction, finalScore, game, apiKey });
    const { error: updateError } = await supabase
      .from("pronostic_history")
      .update({ status, prediction, final_score: finalScore, verified_at: new Date().toISOString() })
      .eq("match_id", String(matchId));
    if (updateError) console.error("Erreur vérification pronostic figé (tennis):", updateError.message);
    else return { status, prediction };
  } catch (e) {
    console.error("Erreur vérification pronostic figé (tennis):", e.message);
  }
}

// Supprime les entrées tennis de plus de 5 jours (PROMPT bloc 8, point 3) — filtrée à
// sport='tennis' pour ne jamais toucher l'historique football/basket.
async function cleanupExpired() {
  const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
  try {
    await supabase.from("pronostic_history").delete().eq("sport", SPORT).not("verified_at", "is", null).lt("verified_at", cutoff);
    await supabase.from("pronostic_history").delete().eq("sport", SPORT).is("verified_at", null).lt("match_date", cutoff);
  } catch (e) {
    console.error("Erreur nettoyage historique pronostic (tennis):", e.message);
  }
}

// Parcourt les pronostics tennis encore "pending", détecte ceux dont le match est
// réellement terminé (vrai statut API-Tennis, relu par id RÉEL), les classe et les
// vérifie ligne par ligne.
async function sweepFinishedPendingPredictions(apiKey) {
  if (!apiKey) return;
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("match_id, prediction, match_date")
      .eq("sport", SPORT)
      .eq("status", "pending")
      .order("match_date", { ascending: false })
      .limit(PENDING_REVALIDATE_LIMIT);
    if (error || !data?.length) return;

    await Promise.all(
      data.map(async (row) => {
        const game = await getGameById(realGameId(row.match_id), apiKey);
        if (!game) return;
        const liveState = mapMatchToLiveState(game);
        if (liveState.status !== "FINISHED") return;
        const finalScore = liveState.score?.fullTime || null;
        const { status, prediction } = await classifyAndVerify({ prediction: row.prediction, finalScore, game, apiKey });
        const { error: updateError } = await supabase
          .from("pronostic_history")
          .update({ status, prediction, final_score: finalScore, verified_at: new Date().toISOString() })
          .eq("match_id", row.match_id);
        if (updateError) console.error("Erreur revérification historique pronostic (tennis):", updateError.message);
      })
    );
  } catch (e) {
    console.error("Erreur revérification historique pronostic (tennis):", e.message);
  }
}

// Jamais plus d'un balayage opportuniste toutes les 5 minutes — même mécanique que le
// football/basket, pour ne jamais faire un appel API-Tennis par pronostic "pending" à
// chaque requête d'une route à fort trafic.
const OPPORTUNISTIC_SWEEP_COOLDOWN_MS = 5 * 60 * 1000;
let lastOpportunisticSweepAt = 0;

export function maybeSweepFinishedPredictions(apiKey) {
  if (!apiKey) return;
  if (Date.now() - lastOpportunisticSweepAt < OPPORTUNISTIC_SWEEP_COOLDOWN_MS) return;
  lastOpportunisticSweepAt = Date.now();
  sweepFinishedPendingPredictions(apiKey).catch((e) => {
    console.error("Erreur balayage opportuniste des pronostics (tennis):", e.message);
  });
}

// Pour les tests : remet le throttle à zéro entre deux cas.
export function __resetSweepThrottleForTests() {
  lastOpportunisticSweepAt = 0;
}

// Toujours un balayage réel, jamais throttlé — utilisé par pages/api/cron/
// settle-predictions.js.
export async function settleFinishedPredictionsNow(apiKey) {
  await sweepFinishedPendingPredictions(apiKey);
}

// Liste les matchs tennis "Succès" ou "Échec", du plus récent au plus ancien — après
// avoir nettoyé les entrées expirées et tenté de classer les matchs "pending" en
// retard (vérifié à chaque chargement de la page).
export async function listAndMaintainHistory(status, apiKey) {
  await cleanupExpired();
  await sweepFinishedPendingPredictions(apiKey);
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("*")
      .eq("sport", SPORT)
      .eq("status", status)
      .order("match_date", { ascending: false })
      .limit(50);
    if (error) {
      console.error("Erreur lecture historique pronostic (tennis):", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("Erreur lecture historique pronostic (tennis):", e.message);
    return [];
  }
}

export { getTennisApiKey };
