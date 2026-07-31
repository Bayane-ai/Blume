import { supabaseAnon as supabase } from "../../supabaseAnon";
import { getGameById, getGameStatistics, getBasketballApiKey } from "./provider";
import { mapGameStatusToBlumeStatus } from "./mapper";
import { STAT_ALIASES, statisticValue } from "./statProfiles";

// Bloc 4 (multi-sport, basket) — équivalent basket de lib/pronosticHistory.js : même
// table pronostic_history (voir supabase/migrations/0002_pronostic_history.sql et
// 0014_pronostic_history_sport_column.sql), mêmes deux rôles (figer le pronostic
// affiché ; alimenter "Probabilités réussies/échouées"), simplement `sport:
// "basketball"` et des lignes de vérification propres au basket (pas de match nul,
// pas de corners/cartons, mais rebonds/passes/3 points/fautes/ballons perdus/lancers
// francs). Contrairement au football (qui doit retrouver le match APRÈS coup par date
// + noms d'équipe côté API-Football, best-effort), on connaît déjà l'id RÉEL du match
// basket (`bk-<id>`) : la vérification finale peut donc relire directement CE match
// précis (getGameById/getGameStatistics), jamais une correspondance approximative.

const EXPIRY_DAYS = 5;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;
const PENDING_REVALIDATE_LIMIT = 15;
const SPORT = "basketball";

// Un match basket est TOUJOURS identifié par un id "bk-..." (voir lib/sports/
// basketball/mapper.js) — jamais l'inverse d'un id football, donc jamais besoin d'un
// repli "impossible à persister" comme canPersistMatch("af-...") côté football.
export function canPersistMatch(matchId) {
  return Boolean(matchId) && String(matchId).startsWith("bk-");
}

function realGameId(matchId) {
  return String(matchId).replace(/^bk-/, "");
}

// Ne garde du pronostic complet que ce qui relève vraiment d'une PRÉDICTION — jamais
// les champs live éphémères (matchStatus, matchScore, live, available), qui
// continuent d'évoluer normalement pendant le match et sont réappliqués par-dessus le
// pronostic figé (voir pages/api/basketball/analyze.js).
export function toPredictionSnapshot(result) {
  if (!result) return null;
  const {
    home, away, probabilities, goals, correctScores, pointSpread, markets, periods,
    rebounds, assists, threePointers, fouls, turnovers, freeThrows, players, narrative,
    note, statsNote, sdHome, sdAway,
  } = result;
  return {
    home, away, probabilities, goals, correctScores, pointSpread, markets, periods,
    rebounds, assists, threePointers, fouls, turnovers, freeThrows, players, narrative,
    note, statsNote, sdHome, sdAway,
  };
}

// Basket : PAS de match nul (voir lib/sports/basketball/pronosticModel.js) — l'équipe
// favorite désignée avant match est simplement celle dont la probabilité de victoire
// est la plus haute (domicile vs extérieur, jamais une troisième issue).
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

function verifyWinnerLine(prediction, finalScore) {
  const outcome = classifyOutcome(prediction, finalScore);
  return outcome == null ? null : outcome === "success";
}

// Ligne "Plus/Moins de X,5" comparée au vrai chiffre — `true` (atteinte), `false`
// (ratée) ou `null` quand la donnée réelle nécessaire manque (jamais un crochet/une
// croix inventés).
function verifyLine(market, realValue) {
  if (!market?.available || market.line == null || !market.side) return null;
  if (realValue == null || !Number.isFinite(realValue)) return null;
  return market.side === "Plus" ? realValue > market.line : realValue < market.line;
}

// Écart de points (safe/risky, voir lib/sports/basketball/pronosticModel.js#
// buildPointSpread) — même mécanique que les cartons jaunes/rouges côté football :
// chaque niveau de risque est sa propre ligne, vérifiée contre le vrai écart final
// (toujours positif, quel que soit le favori).
function verifyRiskLines(market, realValue) {
  if (!market) return { safe: null, risky: null };
  return { safe: verifyLine(market.safe, realValue), risky: verifyLine(market.risky, realValue) };
}

// Rebonds/passes/3 points/fautes (voir lib/sports/basketball/pronosticModel.js#
// buildOwnStatBlock) : Total match + Total 1 (domicile) + Total 2 (extérieur),
// chacune sa propre ligne vérifiée individuellement contre le vrai décompte final de
// cette métrique.
function verifyStatBlock(block, realHome, realAway) {
  const realTotal = Number.isFinite(realHome) && Number.isFinite(realAway) ? realHome + realAway : null;
  return {
    total: verifyLine(block?.total, realTotal),
    home: verifyLine(block?.home, realHome),
    away: verifyLine(block?.away, realAway),
  };
}

// Scores finaux probables : validés si L'UN des scores prédits correspond EXACTEMENT
// au score final (jamais un score "proche") — même règle que les scores exacts du
// football, format déjà "home-away" en chaîne (voir pronosticModel.js#correctScores).
function verifyCorrectScoresLine(correctScores, finalScore) {
  const home = Number(finalScore?.home);
  const away = Number(finalScore?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (!Array.isArray(correctScores) || correctScores.length === 0) return null;
  return correctScores.includes(`${home}-${away}`);
}

// Lignes prises en compte pour le classement Succès/Échec du match (même principe que
// lib/pronosticHistory.js#classifyByMajority : la MAJORITÉ des lignes réellement
// vérifiables) — les blocs "Joueurs à suivre" ne comptent volontairement pas ici (des
// pronostics par joueur, pas des lignes de marché du match).
const MAJORITY_SIMPLE_KEYS = ["winner", "correctScores", "totalPoints", "totalHome", "totalAway", "quarter1", "firstHalf", "secondHalf"];
const MAJORITY_STAT_BLOCK_KEYS = ["rebounds", "assists", "threePointers", "fouls"]; // chacun -> total/home/away
const MAJORITY_SINGLE_TOTAL_KEYS = ["turnovers", "freeThrows"]; // chacun -> total seulement
const MAJORITY_RISK_KEYS = ["pointSpread"]; // -> safe/risky

function countLineVerdicts(verification) {
  let success = 0;
  let failure = 0;
  const tally = (v) => {
    if (v === true) success++;
    else if (v === false) failure++;
  };
  for (const key of MAJORITY_SIMPLE_KEYS) tally(verification?.[key]);
  for (const key of MAJORITY_STAT_BLOCK_KEYS) {
    tally(verification?.[key]?.total);
    tally(verification?.[key]?.home);
    tally(verification?.[key]?.away);
  }
  for (const key of MAJORITY_SINGLE_TOTAL_KEYS) tally(verification?.[key]?.total);
  for (const key of MAJORITY_RISK_KEYS) {
    tally(verification?.[key]?.safe);
    tally(verification?.[key]?.risky);
  }
  return { success, failure };
}

// `null` uniquement si AUCUNE ligne n'est vérifiable (ne devrait jamais arriver en
// pratique : le score final rend toujours au moins l'issue du match vérifiable).
export function classifyByMajority(verification) {
  if (!verification) return null;
  const { success, failure } = countLineVerdicts(verification);
  if (success + failure === 0) return null;
  return success > failure ? "success" : "failure";
}

// Vraies statistiques finales de CE match précis (rebonds/passes/3 points/fautes/
// ballons perdus/lancers francs par équipe) — via l'id RÉEL déjà connu du match
// (jamais une recherche approximative par date/nom d'équipe comme côté football).
// `null` en silence si la clé API manque, si la source échoue, ou si les données ne
// sont pas exploitables — jamais une exception qui interromprait la vérification (les
// lignes de points restent vérifiables via le vrai score final, toujours connu).
async function fetchRealFinalStats(game, apiKey) {
  if (!game?.id || !apiKey) return null;
  try {
    const stats = await getGameStatistics(game.id, apiKey);
    if (!Array.isArray(stats) || !stats.length) return null;
    const homeId = game?.teams?.home?.id;
    const awayId = game?.teams?.away?.id;
    const homeEntry = stats.find((s) => String(s?.team?.id) === String(homeId));
    const awayEntry = stats.find((s) => String(s?.team?.id) === String(awayId));
    const pick = (entry, aliases) => statisticValue(entry?.statistics, aliases);
    return {
      rebounds: { home: pick(homeEntry, STAT_ALIASES.rebounds), away: pick(awayEntry, STAT_ALIASES.rebounds) },
      assists: { home: pick(homeEntry, STAT_ALIASES.assists), away: pick(awayEntry, STAT_ALIASES.assists) },
      threePointersMade: { home: pick(homeEntry, STAT_ALIASES.threePointersMade), away: pick(awayEntry, STAT_ALIASES.threePointersMade) },
      fouls: { home: pick(homeEntry, STAT_ALIASES.fouls), away: pick(awayEntry, STAT_ALIASES.fouls) },
      turnovers: { home: pick(homeEntry, STAT_ALIASES.turnovers), away: pick(awayEntry, STAT_ALIASES.turnovers) },
      freeThrowsMade: { home: pick(homeEntry, STAT_ALIASES.freeThrowsMade), away: pick(awayEntry, STAT_ALIASES.freeThrowsMade) },
    };
  } catch (e) {
    console.error("Erreur récupération statistiques finales (basket):", e.message);
    return null;
  }
}

function sumOrNull(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? a + b : null;
}

// Vrais totaux par période (1er quart-temps, 1ère/2ème mi-temps) — directement lisibles
// dans le score officiel une fois le match terminé (game.scores.*.quarter_N, des
// points RÉELLEMENT marqués dans chaque quart), jamais une estimation.
function realPeriodTotals(game) {
  const h = game?.scores?.home || {};
  const a = game?.scores?.away || {};
  const q1 = sumOrNull(h.quarter_1, a.quarter_1);
  const firstHalf = sumOrNull(sumOrNull(h.quarter_1, h.quarter_2), sumOrNull(a.quarter_1, a.quarter_2));
  const finalTotal = sumOrNull(h.total, a.total);
  const secondHalf = finalTotal != null && firstHalf != null ? finalTotal - firstHalf : null;
  return { quarter1: q1, firstHalf, secondHalf };
}

// Classe le pronostic FIGÉ contre le vrai résultat : compare CHAQUE ligne
// individuellement, PUIS classe le match Succès/Échec selon la majorité de ces lignes
// (classifyByMajority) — jamais uniquement l'issue du match seule. `verification` est
// fusionnée DANS le pronostic figé lui-même (colonne `prediction`, déjà en jsonb).
async function classifyAndVerify({ prediction, finalScore, game, apiKey }) {
  const realStats = await fetchRealFinalStats(game, apiKey);
  const home = Number(finalScore?.home);
  const away = Number(finalScore?.away);
  const hasScore = Number.isFinite(home) && Number.isFinite(away);
  const periods = realPeriodTotals(game);
  const margin = hasScore ? Math.abs(home - away) : null;

  const verification = {
    winner: verifyWinnerLine(prediction, finalScore),
    correctScores: verifyCorrectScoresLine(prediction?.correctScores, finalScore),
    totalPoints: hasScore ? verifyLine(prediction?.markets?.totalPoints, home + away) : null,
    totalHome: hasScore ? verifyLine(prediction?.markets?.totalHome, home) : null,
    totalAway: hasScore ? verifyLine(prediction?.markets?.totalAway, away) : null,
    quarter1: verifyLine(prediction?.periods?.quarter1, periods.quarter1),
    firstHalf: verifyLine(prediction?.periods?.firstHalf, periods.firstHalf),
    secondHalf: verifyLine(prediction?.periods?.secondHalf, periods.secondHalf),
    pointSpread: margin != null ? verifyRiskLines(prediction?.pointSpread, margin) : { safe: null, risky: null },
    rebounds: verifyStatBlock(prediction?.rebounds, realStats?.rebounds?.home, realStats?.rebounds?.away),
    assists: verifyStatBlock(prediction?.assists, realStats?.assists?.home, realStats?.assists?.away),
    threePointers: verifyStatBlock(prediction?.threePointers, realStats?.threePointersMade?.home, realStats?.threePointersMade?.away),
    fouls: verifyStatBlock(prediction?.fouls, realStats?.fouls?.home, realStats?.fouls?.away),
    turnovers: { total: verifyLine(prediction?.turnovers?.total, sumOrNull(realStats?.turnovers?.home, realStats?.turnovers?.away)) },
    freeThrows: { total: verifyLine(prediction?.freeThrows?.total, sumOrNull(realStats?.freeThrowsMade?.home, realStats?.freeThrowsMade?.away)) },
  };
  const status = classifyByMajority(verification) || "pending";
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
      console.error("Erreur lecture pronostic figé (basket):", error.message);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error("Erreur lecture pronostic figé (basket):", e.message);
    return null;
  }
}

// Fige le pronostic d'un match analysé pour la PREMIÈRE fois — upsert avec
// ignoreDuplicates (un appel concurrent ne peut jamais écraser). Si le match est déjà
// terminé au moment de cette toute première analyse, le classe directement au lieu de
// rester "pending" pour rien, et renvoie {status, prediction} pour un affichage
// immédiat du compte-rendu (voir pages/api/basketball/analyze.js).
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
    if (error) console.error("Erreur sauvegarde pronostic figé (basket):", error.message);
    else if (isFinished) return { status, prediction: predictionToSave };
  } catch (e) {
    console.error("Erreur sauvegarde pronostic figé (basket):", e.message);
  }
}

// Compte-rendu de fin de match : compare le pronostic FIGÉ (jamais un recalcul) au vrai
// résultat, classe Succès/Échec — idempotent (ne fait rien si déjà classé). Renvoie
// {status, prediction} UNIQUEMENT quand une ligne "pending" vient d'être classée ici.
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
    if (updateError) console.error("Erreur vérification pronostic figé (basket):", updateError.message);
    else return { status, prediction };
  } catch (e) {
    console.error("Erreur vérification pronostic figé (basket):", e.message);
  }
}

// Supprime les entrées basket de plus de 5 jours (PROMPT étape 5) — même règle que le
// football (verified_at si déjà classé, sinon match_date), filtrée à sport='basketball'
// pour ne jamais toucher l'historique football.
async function cleanupExpired() {
  const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
  try {
    await supabase.from("pronostic_history").delete().eq("sport", SPORT).not("verified_at", "is", null).lt("verified_at", cutoff);
    await supabase.from("pronostic_history").delete().eq("sport", SPORT).is("verified_at", null).lt("match_date", cutoff);
  } catch (e) {
    console.error("Erreur nettoyage historique pronostic (basket):", e.message);
  }
}

// Parcourt les pronostics basket encore "pending", détecte ceux dont le match est
// réellement terminé (vrai statut API-Basketball, relu par id RÉEL — jamais une
// recherche approximative), les classe et les vérifie ligne par ligne.
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
        if (!game || mapGameStatusToBlumeStatus(game.status?.short) !== "FINISHED") return;
        const finalScore = { home: game.scores?.home?.total ?? null, away: game.scores?.away?.total ?? null };
        const { status, prediction } = await classifyAndVerify({ prediction: row.prediction, finalScore, game, apiKey });
        const { error: updateError } = await supabase
          .from("pronostic_history")
          .update({ status, prediction, final_score: finalScore, verified_at: new Date().toISOString() })
          .eq("match_id", row.match_id);
        if (updateError) console.error("Erreur revérification historique pronostic (basket):", updateError.message);
      })
    );
  } catch (e) {
    console.error("Erreur revérification historique pronostic (basket):", e.message);
  }
}

// Jamais plus d'un balayage opportuniste toutes les 5 minutes — même mécanique que
// lib/pronosticHistory.js, pour ne jamais faire un appel API-Basketball par pronostic
// "pending" à chaque requête d'une route à fort trafic.
const OPPORTUNISTIC_SWEEP_COOLDOWN_MS = 5 * 60 * 1000;
let lastOpportunisticSweepAt = 0;

export function maybeSweepFinishedPredictions(apiKey) {
  if (!apiKey) return;
  if (Date.now() - lastOpportunisticSweepAt < OPPORTUNISTIC_SWEEP_COOLDOWN_MS) return;
  lastOpportunisticSweepAt = Date.now();
  sweepFinishedPendingPredictions(apiKey).catch((e) => {
    console.error("Erreur balayage opportuniste des pronostics (basket):", e.message);
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

// Liste les matchs basket "Succès" ou "Échec", du plus récent au plus ancien — après
// avoir nettoyé les entrées expirées et tenté de classer les matchs "pending" en
// retard (vérifié à chaque chargement de la page, voir PROMPT étape 5 côté football,
// même principe ici).
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
      console.error("Erreur lecture historique pronostic (basket):", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("Erreur lecture historique pronostic (basket):", e.message);
    return [];
  }
}

export { getBasketballApiKey };
