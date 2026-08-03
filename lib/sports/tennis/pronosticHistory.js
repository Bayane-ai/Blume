import { supabaseAnon as supabase } from "../../supabaseAnon";
import { getMatchScore, getTennisApiKey } from "./provider";
import { mapMatchToLiveState } from "./mapper";

// Bloc "historique" tennis — même table Supabase pronostic_history que le football/
// basket (voir supabase/migrations/0002_pronostic_history.sql et
// 0014_pronostic_history_sport_column.sql), `sport: "tennis"`. Reconstruit pour la
// nouvelle intégration Live Tennis API (voir lib/sports/tennis/livePronostic.js) :
// SEULES 3 lignes sont vérifiables après coup (winner, totalGames, totalSets) — le
// vainqueur du set en cours est une métrique transitoire propre au moment où le
// pronostic a été figé, sans sens une fois le match terminé.
//
// RÈGLE DE CLASSEMENT (identique à l'ancienne intégration) : "joueur prédit gagnant
// qui gagne -> Succès, sinon -> Échec." — SEULE cette ligne détermine l'onglet
// Probabilités réussies/échouées ; totalGames/totalSets reçoivent leur propre crochet
// individuel mais ne pèsent jamais dans ce classement.

const EXPIRY_DAYS = 5;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;
const PENDING_REVALIDATE_LIMIT = 15;
const SPORT = "tennis";

export function canPersistMatch(matchId) {
  return Boolean(matchId) && String(matchId).startsWith("tn-");
}

function realMatchId(matchId) {
  return String(matchId).replace(/^tn-/, "");
}

// Ne garde que ce qui relève d'une PRÉDICTION — jamais les champs live éphémères
// (matchStatus/matchScore/matchMinute/matchPeriod/server/live/sets), réappliqués
// par-dessus à chaque analyse (voir pages/api/tennis/analyze.js). `modelState` EST
// conservé : il permet au recalcul en direct de reprendre sans redemander le
// classement des deux joueurs.
export function toPredictionSnapshot(result) {
  if (!result) return null;
  const { home, away, bestOf, probabilities, currentSetProbabilities, gameTotals, totalSets, modelState, note } = result;
  return { home, away, bestOf, probabilities, currentSetProbabilities, gameTotals, totalSets, modelState, note };
}

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

function verifyLine(market, realValue) {
  if (!market || market.line == null || !market.side) return null;
  if (realValue == null || !Number.isFinite(realValue)) return null;
  return market.side === "Plus" ? realValue > market.line : realValue < market.line;
}

function realGameTotals(sets) {
  let home = 0;
  let away = 0;
  let any = false;
  for (const s of sets || []) {
    if (Number.isFinite(s?.home) && Number.isFinite(s?.away)) {
      home += s.home;
      away += s.away;
      any = true;
    }
  }
  return any ? home + away : null;
}

// Classe le pronostic FIGÉ contre le vrai résultat final — winner (règle de
// classement, voir en-tête), totalGames, totalSets. `finalSets` : le vrai score par
// set du match terminé (voir lib/sports/tennis/mapper.js#mapLiveTennisMatch).
function classifyAndVerify({ prediction, finalScore, finalSets }) {
  const outcome = classifyOutcome(prediction, finalScore);
  const verification = {
    winner: outcome == null ? null : outcome === "success",
    totalGames: verifyLine(prediction?.gameTotals, realGameTotals(finalSets)),
    totalSets: verifyLine(prediction?.totalSets, Array.isArray(finalSets) ? finalSets.length : null),
  };
  const status = outcome || "pending";
  return { status, prediction: { ...prediction, verification } };
}

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

export async function saveFrozenPrediction({ matchId, homeTeamName, awayTeamName, matchDate, result, matchStatus, finalScore, finalSets }) {
  if (!canPersistMatch(matchId) || !homeTeamName || !awayTeamName) return;
  const snapshot = toPredictionSnapshot(result);
  if (!snapshot) return;

  try {
    const isFinished = matchStatus === "FINISHED";
    let status = "pending";
    let predictionToSave = snapshot;
    if (isFinished) {
      const classified = classifyAndVerify({ prediction: snapshot, finalScore, finalSets });
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

export async function verifyFrozenPrediction(matchId, finalScore, finalSets) {
  if (!canPersistMatch(matchId)) return;
  try {
    const { data: pendingRow, error: selectError } = await supabase
      .from("pronostic_history")
      .select("prediction")
      .eq("match_id", String(matchId))
      .eq("status", "pending")
      .maybeSingle();
    if (selectError || !pendingRow) return;

    const { status, prediction } = classifyAndVerify({ prediction: pendingRow.prediction, finalScore, finalSets });
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

async function cleanupExpired() {
  const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
  try {
    await supabase.from("pronostic_history").delete().eq("sport", SPORT).not("verified_at", "is", null).lt("verified_at", cutoff);
    await supabase.from("pronostic_history").delete().eq("sport", SPORT).is("verified_at", null).lt("match_date", cutoff);
  } catch (e) {
    console.error("Erreur nettoyage historique pronostic (tennis):", e.message);
  }
}

// Relit le score détaillé du match via l'id RÉEL (voir lib/sports/tennis/
// provider.js#getMatchScore) — seul moyen dont dispose Live Tennis API pour
// retrouver l'état d'UN match précis (pas de recherche par id en dehors de cet
// endpoint, voir PROMPT). `null` si la clé manque ou si l'appel échoue.
async function fetchFinalState(matchId, apiKey) {
  if (!apiKey) return null;
  try {
    const rawScore = await getMatchScore(realMatchId(matchId), apiKey);
    if (!rawScore) return null;
    return mapMatchToLiveState({ id: realMatchId(matchId), status: rawScore?.status }, rawScore);
  } catch (e) {
    console.error("Erreur relecture score (tennis):", e.message);
    return null;
  }
}

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
        const liveState = await fetchFinalState(row.match_id, apiKey);
        if (!liveState || liveState.status !== "FINISHED") return;
        const finalScore = liveState.score?.fullTime || null;
        const { status, prediction } = classifyAndVerify({ prediction: row.prediction, finalScore, finalSets: liveState.sets });
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

export function __resetSweepThrottleForTests() {
  lastOpportunisticSweepAt = 0;
}

export async function settleFinishedPredictionsNow(apiKey) {
  await sweepFinishedPendingPredictions(apiKey);
}

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
