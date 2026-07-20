import { supabase } from "./supabaseClient";
import { getLiveMatch } from "./liveMatchCache";

// Historique global (pas par compte) des pronostics vérifiés à la fin de chaque match
// — table pronostic_history, voir supabase/migrations/0002_pronostic_history.sql.
// Toute erreur Supabase (table pas encore créée, réseau...) est journalisée mais
// n'interrompt jamais /api/analyze ni les pages "Probabilités réussies/échouées" :
// cette fonctionnalité est un complément, pas une dépendance du reste du site.

const EXPIRY_DAYS = 5;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;
// Borne le nombre de matchs "pending" revérifiés à chaque chargement des pages
// d'historique — un visiteur normal ne doit jamais déclencher un pic d'appels à
// football-data.org (quota partagé de 10 requêtes/minute).
const PENDING_REVALIDATE_LIMIT = 15;

// Ne garde du pronostic complet que ce qui relève vraiment d'une PRÉDICTION (1X2,
// totaux, scores exacts, corners/hors-jeu/fautes/touches, buteurs probables) — jamais
// les champs live éphémères (score en cours, minute, fil d'événements), qui n'ont pas
// de sens une fois figés au moment de la sauvegarde.
export function toPredictionSnapshot(result) {
  if (!result) return null;
  const {
    probabilities, goals, correctScores, extraStats, markets, matchStats,
    probableScorers, note, statsNote, liveStatNote,
  } = result;
  return { probabilities, goals, correctScores, extraStats, markets, matchStats, probableScorers, note, statsNote, liveStatNote };
}

// Les pronostics "principaux", jugés objectivement contre le VRAI score final : le
// sens 1X2 (quelle issue était donnée favorite) et le sens Plus/Moins du Total de
// buts. Jamais les stats estimées (corners, hors-jeu...), qu'on ne peut pas toujours
// reconfirmer avec certitude match par match — les juger fausserait le bilan affiché.
export function classifyOutcome(prediction, finalScore) {
  const home = Number(finalScore?.home);
  const away = Number(finalScore?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

  const probs = prediction?.probabilities;
  if (!probs) return null;
  const predictedOutcome =
    probs.home >= probs.draw && probs.home >= probs.away ? "home"
      : probs.away >= probs.draw ? "away"
        : "draw";
  const actualOutcome = home > away ? "home" : away > home ? "away" : "draw";
  const winnerCorrect = predictedOutcome === actualOutcome;

  const totalMarket = prediction?.markets?.totalGoals;
  let totalCorrect = true; // pas de marché total exploitable : ne pénalise pas sur ce critère
  if (totalMarket?.line != null && totalMarket?.side) {
    const actualTotal = home + away;
    totalCorrect = totalMarket.side === "Plus" ? actualTotal > totalMarket.line : actualTotal < totalMarket.line;
  }

  return winnerCorrect && totalCorrect ? "success" : "failure";
}

// Sauvegarde le pronostic d'un match ANALYSÉ par l'app (visité au moins une fois),
// avant/pendant le match — une seule fois par match (upsert avec ignoreDuplicates :
// revisiter la même page pendant le direct ne réécrit jamais le pronostic déjà
// figé). Si le match est déjà terminé au moment de cette toute première sauvegarde
// (ex : quelqu'un ouvre la page après coup), le classe directement au lieu de rester
// "pending" pour rien. Ignoré pour les matchs identifiés uniquement par API-Football
// ("af-..."), dont le statut ne peut pas être revérifié plus tard de la même façon.
export async function saveAndVerifyPrediction({
  matchId, competitionCode, homeTeamName, awayTeamName, matchDate, prediction, matchStatus, finalScore,
}) {
  if (!matchId || String(matchId).startsWith("af-") || !homeTeamName || !awayTeamName) return;
  const snapshot = toPredictionSnapshot(prediction);
  if (!snapshot) return;

  try {
    const isFinished = matchStatus === "FINISHED";
    const status = isFinished ? classifyOutcome(snapshot, finalScore) || "pending" : "pending";
    const { error: upsertError } = await supabase.from("pronostic_history").upsert(
      {
        match_id: String(matchId),
        competition_code: competitionCode || null,
        home_team_name: homeTeamName,
        away_team_name: awayTeamName,
        match_date: matchDate || null,
        prediction: snapshot,
        status,
        final_score: isFinished ? finalScore : null,
        verified_at: isFinished ? new Date().toISOString() : null,
      },
      { onConflict: "match_id", ignoreDuplicates: true }
    );
    if (upsertError) {
      console.error("Erreur sauvegarde historique pronostic:", upsertError.message);
      return;
    }

    // Le upsert ci-dessus n'écrit rien si la ligne existe déjà (ignoreDuplicates) :
    // c'est là qu'un match déjà sauvegardé, mais encore "pending", peut passer à
    // Succès/Échec dès qu'on revoit qu'il est désormais terminé.
    if (!isFinished) return;
    const { data: pendingRow, error: selectError } = await supabase
      .from("pronostic_history")
      .select("prediction")
      .eq("match_id", String(matchId))
      .eq("status", "pending")
      .maybeSingle();
    if (selectError || !pendingRow) return;

    const verifiedStatus = classifyOutcome(pendingRow.prediction, finalScore) || "pending";
    const { error: updateError } = await supabase
      .from("pronostic_history")
      .update({ status: verifiedStatus, final_score: finalScore, verified_at: new Date().toISOString() })
      .eq("match_id", String(matchId));
    if (updateError) console.error("Erreur vérification historique pronostic:", updateError.message);
  } catch (e) {
    console.error("Erreur historique pronostic:", e.message);
  }
}

// Supprime les entrées de plus de 5 jours (voir PROMPT étape 5) : "date de fin" =
// verified_at pour un match déjà classé Succès/Échec ; à défaut (encore "pending" —
// jamais revérifié à temps), on retombe sur la date du match (coup d'envoi), qui
// borne quand même une ancienneté réelle.
async function cleanupExpired() {
  const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
  try {
    await supabase.from("pronostic_history").delete().not("verified_at", "is", null).lt("verified_at", cutoff);
    await supabase.from("pronostic_history").delete().is("verified_at", null).lt("match_date", cutoff);
  } catch (e) {
    console.error("Erreur nettoyage historique pronostic:", e.message);
  }
}

// Revérifie les matchs encore "pending" (personne ne les a revisités juste à la fin) :
// se déclenche au chargement des pages "Probabilités réussies/échouées", donc "sans
// action de l'utilisateur" au sens où aucun visiteur n'a besoin de cliquer sur quoi
// que ce soit — seulement d'ouvrir la page. Nécessite le token football-data.org
// (fourni par la route API, jamais exposé côté navigateur).
async function revalidatePending(token) {
  if (!token) return;
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("match_id, prediction")
      .eq("status", "pending")
      .order("match_date", { ascending: false })
      .limit(PENDING_REVALIDATE_LIMIT);
    if (error || !data?.length) return;

    await Promise.all(
      data.map(async (row) => {
        const liveMatch = await getLiveMatch(row.match_id, token);
        if (liveMatch?.status !== "FINISHED") return;
        const finalScore = liveMatch.score?.fullTime;
        const status = classifyOutcome(row.prediction, finalScore) || "pending";
        const { error: updateError } = await supabase
          .from("pronostic_history")
          .update({ status, final_score: finalScore, verified_at: new Date().toISOString() })
          .eq("match_id", row.match_id);
        if (updateError) console.error("Erreur revérification historique pronostic:", updateError.message);
      })
    );
  } catch (e) {
    console.error("Erreur revérification historique pronostic:", e.message);
  }
}

// Liste les matchs "Succès" ou "Échec", du plus récent au plus ancien — après avoir
// nettoyé les entrées expirées et tenté de classer les matchs "pending" en retard :
// voir PROMPT étape 5 ("vérifié à chaque chargement de la page").
export async function listAndMaintainHistory(status, token) {
  await cleanupExpired();
  await revalidatePending(token);
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("*")
      .eq("status", status)
      .order("match_date", { ascending: false })
      .limit(50);
    if (error) {
      console.error("Erreur lecture historique pronostic:", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("Erreur lecture historique pronostic:", e.message);
    return [];
  }
}
