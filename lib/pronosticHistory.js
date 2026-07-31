import { supabaseAnon as supabase } from "./supabaseAnon";
import { getLiveMatch } from "./liveMatchCache";
import { fetchRealMatchStats, verifyPredictionLines } from "./pronosticVerification";

// Historique global (pas par compte) des pronostics — table pronostic_history, voir
// supabase/migrations/0002_pronostic_history.sql. Deux rôles :
//   1) FIGER le pronostic affiché : calculé une seule fois avant/à la première analyse
//      du match, puis relu tel quel à chaque actualisation pendant tout le match —
//      jamais recalculé à partir du score ou de la minute en direct (voir
//      pages/api/analyze.js). Les lignes de pronostics sont une référence stable pour
//      le parieur ; seuls le score, la minute et la timeline restent réellement en
//      direct.
//   2) Alimenter les pages "Probabilités réussies/échouées" : à la fin du match, le
//      pronostic FIGÉ est comparé au vrai résultat pour être classé Succès/Échec.
// Toute erreur Supabase (table pas encore créée, réseau...) est journalisée mais
// n'interrompt jamais /api/analyze ni les pages d'historique : cette fonctionnalité
// est un complément, pas une dépendance du reste du site.

const EXPIRY_DAYS = 5;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;
// Borne le nombre de matchs "pending" revérifiés à chaque chargement des pages
// d'historique — un visiteur normal ne doit jamais déclencher un pic d'appels à
// football-data.org (quota partagé de 10 requêtes/minute).
const PENDING_REVALIDATE_LIMIT = 15;

// Un match identifié uniquement par API-Football ("af-...") ne peut pas être
// revérifié plus tard de la même façon (pas de repli football-data.org fiable) — le
// pronostic reste quand même figé pour L'AFFICHAGE (computePronostic ne dépend jamais
// du score/de la minute, donc son résultat est déjà stable d'un appel à l'autre sans
// persistance), simplement sans alimenter l'historique Succès/Échec.
export function canPersistMatch(matchId) {
  return Boolean(matchId) && !String(matchId).startsWith("af-");
}

// Ne garde du pronostic complet que ce qui relève vraiment d'une PRÉDICTION (1X2,
// totaux, scores exacts, corners/hors-jeu/fautes/touches, buteurs probables, contexte
// des deux équipes) — jamais les champs live éphémères (score en cours, minute, statut,
// fil d'événements, stade, arbitre), qui continuent d'évoluer normalement pendant le
// match et sont réappliqués par-dessus le pronostic figé (voir pages/api/analyze.js).
export function toPredictionSnapshot(result) {
  if (!result) return null;
  const {
    home, away, probabilities, goals, correctScores, extraStats, markets, matchStats,
    probableScorers, cardProneness, h2hUsed, note, statsNote, liveStatNote,
  } = result;
  return {
    home, away, probabilities, goals, correctScores, extraStats, markets, matchStats,
    probableScorers, cardProneness, h2hUsed, note, statsNote, liveStatNote,
  };
}

// Le badge global Succès/Échec (Bloc 3 du parcours vidéo) : la probabilité de
// victoire posée AVANT le match désigne une équipe favorite (celle dont la
// probabilité — domicile/nul/extérieur — est la plus haute) ; si cette issue se
// vérifie réellement à la fin du match → "Succès", sinon → "Échec". Jugé UNIQUEMENT
// sur cette question — le Total de buts et les autres lignes estimées (corners,
// hors-jeu...) ne comptent plus dans ce verdict global ; elles restent vérifiées
// individuellement, avec leur propre crochet/croix, voir lib/pronosticVerification.js.
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

  return predictedOutcome === actualOutcome ? "success" : "failure";
}

// Ligne "Issue du match" : reprend classifyOutcome ci-dessus (l'équipe favorite
// désignée avant le match a-t-elle réellement gagné ?), convertie en verdict ligne
// par ligne (true/false/null) — au même titre que n'importe quelle autre ligne (voir
// PROMPT point 5, "même logique pour toutes les lignes, sans exception").
function verifyWinnerLine(prediction, finalScore) {
  const outcome = classifyOutcome(prediction, finalScore);
  return outcome == null ? null : outcome === "success";
}

// Scores exacts : validés si L'UN des scores prédits correspond EXACTEMENT au score
// final (voir PROMPT point 3) — jamais un score "proche".
function verifyCorrectScoresLine(correctScores, finalScore) {
  const home = Number(finalScore?.home);
  const away = Number(finalScore?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (!Array.isArray(correctScores) || correctScores.length === 0) return null;
  const actual = `${home}-${away}`;
  return correctScores.some((s) => s?.score === actual);
}

// Lignes prises en compte pour le classement Succès/Échec du match (PROMPT point 4 :
// "la MAJORITÉ de ses lignes est validée") — chaque sous-ligne compte pour une voix,
// jamais les lignes "Indisponible" (null), qui ne comptent ni pour ni contre (aucune
// donnée réelle ne permet de trancher, donc aucun verdict à leur sujet). "Touches"
// (toujours indisponible, aucune source ne la fournit) et la ligne "1ère mi-temps"
// (jamais vérifiable, voir lib/pronosticVerification.js) sont ainsi naturellement
// exclues du calcul, sans traitement spécial.
const MAJORITY_SIMPLE_KEYS = ["winner", "correctScores", "totalGoals", "totalHome", "totalAway", "shots", "shotsOnTarget"];
const MAJORITY_STAT_BLOCK_KEYS = ["corners", "offsides", "fouls"]; // chacun -> total/home/away
const MAJORITY_RISK_KEYS = ["yellowCards", "redCards"]; // chacun -> safe/risky

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
  for (const key of MAJORITY_RISK_KEYS) {
    tally(verification?.[key]?.safe);
    tally(verification?.[key]?.risky);
  }
  return { success, failure };
}

// Classe le match "success" si la MAJORITÉ de ses lignes réellement vérifiables sont
// validées, "failure" sinon (minorité OU égalité stricte — "sinon" au sens du PROMPT).
// `null` uniquement si AUCUNE ligne n'est vérifiable (ne devrait jamais arriver en
// pratique : le score final rend toujours au moins l'issue du match vérifiable).
export function classifyByMajority(verification) {
  if (!verification) return null;
  const { success, failure } = countLineVerdicts(verification);
  if (success + failure === 0) return null;
  return success > failure ? "success" : "failure";
}

// Classe le pronostic FIGÉ contre le vrai résultat : compare CHAQUE ligne
// individuellement (issue du match, scores exacts, totaux, corners, hors-jeu,
// fautes, tirs, tirs cadrés, cartons — voir lib/pronosticVerification.js) pour les
// indicateurs ✓/✗ affichés sur chaque ligne des cartes "Probabilités réussies/
// échouées" (voir PROMPT), PUIS classe le match Succès/Échec selon la MAJORITÉ de ces
// lignes (classifyByMajority) — jamais uniquement l'issue du match seule. `verification`
// est fusionné DANS le pronostic figé lui-même (colonne `prediction`, déjà en jsonb) —
// aucune colonne supplémentaire nécessaire. `apiFootballKey` est optionnel : sans clé
// (ou match introuvable côté API-Football), seules les lignes de buts et l'issue du
// match restent vérifiables (toujours dérivées du VRAI score final, toujours connu),
// le reste devient honnêtement "Indisponible" plutôt qu'un résultat inventé.
async function classifyAndVerify({ prediction, finalScore, homeTeamName, awayTeamName, matchDate, apiFootballKey }) {
  const realStats = await fetchRealMatchStats({ homeTeamName, awayTeamName, matchDate, apiFootballKey });
  const statLines = verifyPredictionLines({ prediction, finalScore, realStats });
  const verification = {
    winner: verifyWinnerLine(prediction, finalScore),
    correctScores: verifyCorrectScoresLine(prediction?.correctScores, finalScore),
    ...statLines,
  };
  const status = classifyByMajority(verification) || "pending";
  return { status, prediction: { ...prediction, verification } };
}

// Relit le pronostic déjà figé pour CE match, s'il existe — c'est LUI qui doit être
// affiché (jamais un nouveau calcul) dès qu'il existe. Renvoie la ligne complète
// (prediction, status, final_score...) ou `null` si ce match n'a encore jamais été
// analysé.
export async function getFrozenPrediction(matchId) {
  if (!canPersistMatch(matchId)) return null;
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("prediction, status, final_score")
      .eq("match_id", String(matchId))
      .maybeSingle();
    if (error) {
      console.error("Erreur lecture pronostic figé:", error.message);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error("Erreur lecture pronostic figé:", e.message);
    return null;
  }
}

// Fige le pronostic d'un match analysé pour la PREMIÈRE fois — une seule fois par
// match (upsert avec ignoreDuplicates : si un autre appel concurrent l'a déjà
// enregistré entre-temps, celui-ci n'écrase rien). Si le match est déjà terminé au
// moment de cette toute première analyse (ex : quelqu'un ouvre la page après coup), le
// classe directement au lieu de rester "pending" pour rien. Renvoie {status,
// prediction} (avec `verification`) UNIQUEMENT quand le match est déjà terminé — voir
// Bloc 4 (pages/api/analyze.js) : la page d'un match consulté pour la toute première
// fois APRÈS sa fin doit pouvoir afficher le compte-rendu (✓/✗) immédiatement, sans
// attendre un second chargement qui relirait la version déjà classée en base.
export async function saveFrozenPrediction({
  matchId, competitionCode, homeTeamName, awayTeamName, matchDate, result, matchStatus, finalScore, apiFootballKey,
}) {
  if (!canPersistMatch(matchId) || !homeTeamName || !awayTeamName) return;
  const snapshot = toPredictionSnapshot(result);
  if (!snapshot) return;

  try {
    const isFinished = matchStatus === "FINISHED";
    let status = "pending";
    let predictionToSave = snapshot;
    if (isFinished) {
      const classified = await classifyAndVerify({
        prediction: snapshot, finalScore, homeTeamName, awayTeamName, matchDate, apiFootballKey,
      });
      status = classified.status;
      predictionToSave = classified.prediction;
    }
    const { error } = await supabase.from("pronostic_history").upsert(
      {
        match_id: String(matchId),
        // Multi-sport (bloc 4) : distingue cette ligne de son équivalent basket (voir
        // lib/sports/basketball/pronosticHistory.js), qui réutilise la MÊME table —
        // jamais utilisée pour retrouver une ligne précise (match_id suffit déjà, les
        // deux espaces d'ids ne se chevauchent jamais), seulement pour que les pages
        // "Probabilités réussies/échouées" de chaque onglet ne se mélangent jamais.
        sport: "football",
        competition_code: competitionCode || null,
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
    if (error) console.error("Erreur sauvegarde pronostic figé:", error.message);
    else if (isFinished) return { status, prediction: predictionToSave };
  } catch (e) {
    console.error("Erreur sauvegarde pronostic figé:", e.message);
  }
}

// Compte-rendu de fin de match (voir PROMPT) : compare le pronostic FIGÉ (jamais celui
// qu'on recalculerait maintenant) au vrai résultat, et classe Succès/Échec — appelé
// uniquement une fois le match constaté "FINISHED", jamais avant. Ne fait rien si le
// match est déjà classé (idempotent : peu importe combien de fois /api/analyze est
// rappelée après la fin du match). Renvoie {status, prediction} (avec `verification`)
// UNIQUEMENT quand une ligne "pending" vient d'être classée ici — voir Bloc 4
// (pages/api/analyze.js) : la requête qui constate EN DIRECT qu'un match suivi vient
// de se terminer doit pouvoir afficher le compte-rendu (✓/✗) immédiatement, sans
// attendre le prochain chargement de la page.
export async function verifyFrozenPrediction(matchId, finalScore, apiFootballKey) {
  if (!canPersistMatch(matchId)) return;
  try {
    const { data: pendingRow, error: selectError } = await supabase
      .from("pronostic_history")
      .select("prediction, home_team_name, away_team_name, match_date")
      .eq("match_id", String(matchId))
      .eq("status", "pending")
      .maybeSingle();
    if (selectError || !pendingRow) return;

    const { status, prediction } = await classifyAndVerify({
      prediction: pendingRow.prediction, finalScore,
      homeTeamName: pendingRow.home_team_name, awayTeamName: pendingRow.away_team_name,
      matchDate: pendingRow.match_date, apiFootballKey,
    });
    const { error: updateError } = await supabase
      .from("pronostic_history")
      .update({ status, prediction, final_score: finalScore, verified_at: new Date().toISOString() })
      .eq("match_id", String(matchId));
    if (updateError) console.error("Erreur vérification pronostic figé:", updateError.message);
    else return { status, prediction };
  } catch (e) {
    console.error("Erreur vérification pronostic figé:", e.message);
  }
}

// Supprime les entrées de plus de 5 jours (voir PROMPT étape 5) : "date de fin" =
// verified_at pour un match déjà classé Succès/Échec ; à défaut (encore "pending" —
// jamais revérifié à temps), on retombe sur la date du match (coup d'envoi), qui
// borne quand même une ancienneté réelle.
async function cleanupExpired() {
  const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
  try {
    await supabase.from("pronostic_history").delete().eq("sport", "football").not("verified_at", "is", null).lt("verified_at", cutoff);
    await supabase.from("pronostic_history").delete().eq("sport", "football").is("verified_at", null).lt("match_date", cutoff);
  } catch (e) {
    console.error("Erreur nettoyage historique pronostic:", e.message);
  }
}

// Cœur du RÈGLEMENT AUTOMATIQUE DE FIN DE MATCH (PROMPT) : parcourt les pronostics
// encore "pending", détecte ceux dont le match est réellement terminé (vrai statut
// football-data.org), les classe (majorité de lignes validées) et les vérifie ligne
// par ligne — utilisée aussi bien par un appel immédiat (visite d'une page
// "Probabilités...", voir listAndMaintainHistory) que par le balayage opportuniste
// (maybeSweepFinishedPredictions, déclenché par le trafic normal du site) et par la
// route cron dédiée (pages/api/cron/settle-predictions.js). Nécessite le token
// football-data.org (fourni par la route API, jamais exposé côté navigateur).
async function sweepFinishedPendingPredictions(token, apiFootballKey) {
  if (!token) return;
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("match_id, prediction, home_team_name, away_team_name, match_date")
      .eq("sport", "football")
      .eq("status", "pending")
      .order("match_date", { ascending: false })
      .limit(PENDING_REVALIDATE_LIMIT);
    if (error || !data?.length) return;

    await Promise.all(
      data.map(async (row) => {
        const liveMatch = await getLiveMatch(row.match_id, token);
        if (liveMatch?.status !== "FINISHED") return;
        const finalScore = liveMatch.score?.fullTime;
        const { status, prediction } = await classifyAndVerify({
          prediction: row.prediction, finalScore,
          homeTeamName: row.home_team_name, awayTeamName: row.away_team_name,
          matchDate: row.match_date, apiFootballKey,
        });
        const { error: updateError } = await supabase
          .from("pronostic_history")
          .update({ status, prediction, final_score: finalScore, verified_at: new Date().toISOString() })
          .eq("match_id", row.match_id);
        if (updateError) console.error("Erreur revérification historique pronostic:", updateError.message);
      })
    );
  } catch (e) {
    console.error("Erreur revérification historique pronostic:", e.message);
  }
}

// Jamais plus d'un balayage opportuniste toutes les 5 minutes, quel que soit le
// nombre de visiteurs/requêtes — sinon, appelé depuis des routes à fort trafic (voir
// pages/api/matches.js, pages/api/live-matches.js), ce balayage referait un appel
// football-data.org par pronostic "pending" à chaque requête.
const OPPORTUNISTIC_SWEEP_COOLDOWN_MS = 5 * 60 * 1000;
let lastOpportunisticSweepAt = 0;

// RÈGLEMENT VRAIMENT AUTOMATIQUE (PROMPT : "sans aucune action de ma part") : avant ce
// balayage opportuniste, un pronostic ne passait de "pending" à "success"/"failure"
// QUE si quelqu'un rouvrait spécifiquement ce match après sa fin, ou visitait une des
// deux pages "Probabilités réussies/échouées" — sinon il restait "pending" pour
// toujours, invisible dans les deux sections. Appelée (sans être attendue, fire-and-
// forget : ne doit jamais ralentir la réponse principale) depuis n'importe quelle
// route à fort trafic, elle fait que N'IMPORTE QUELLE page du site consultée dans les
// minutes qui suivent la fin d'un match suffit à le régler — sans jamais dépendre
// d'une visite délibérée des pages de pronostics.
export function maybeSweepFinishedPredictions(token, apiFootballKey) {
  if (!token) return;
  if (Date.now() - lastOpportunisticSweepAt < OPPORTUNISTIC_SWEEP_COOLDOWN_MS) return;
  lastOpportunisticSweepAt = Date.now();
  sweepFinishedPendingPredictions(token, apiFootballKey).catch((e) => {
    console.error("Erreur balayage opportuniste des pronostics:", e.message);
  });
}

// Pour les tests : remet le throttle à zéro entre deux cas, comme
// lib/security/rateLimit.js#__resetRateLimitForTests.
export function __resetSweepThrottleForTests() {
  lastOpportunisticSweepAt = 0;
}

// Toujours un balayage réel, jamais throttlé (c'est l'appelant qui fixe la fréquence —
// voir pages/api/cron/settle-predictions.js, ou vercel.json pour Vercel Cron) et
// toujours attendu (contrairement au balayage opportuniste ci-dessus).
export async function settleFinishedPredictionsNow(token, apiFootballKey) {
  await sweepFinishedPendingPredictions(token, apiFootballKey);
}

// BLOC 2 (lib/pronosticFromProfiles.js) — VÉRIFICATION AUTOMATIQUE OBLIGATOIRE : les
// pronostics récemment figés (n'importe quel statut — pending/success/failure, jamais
// filtré), pour comparer leurs lignes deux à deux (voir lib/lineDuplicateCheck.js et
// pages/api/admin/recompute.js) et repérer deux matchs affichés avec exactement le
// même jeu de lignes — un vrai bug de calcul à corriger, jamais masqué.
export async function listRecentPredictionsForDuplicateCheck({ limit = 200 } = {}) {
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("match_id, prediction")
      .eq("sport", "football")
      .order("match_date", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("Erreur lecture historique pronostic (vérification doublons):", error.message);
      return [];
    }
    return (data || []).map((row) => ({ matchId: row.match_id, pronostic: row.prediction }));
  } catch (e) {
    console.error("Erreur lecture historique pronostic (vérification doublons):", e.message);
    return [];
  }
}

// Liste les matchs "Succès" ou "Échec", du plus récent au plus ancien — après avoir
// nettoyé les entrées expirées et tenté de classer les matchs "pending" en retard :
// voir PROMPT étape 5 ("vérifié à chaque chargement de la page").
export async function listAndMaintainHistory(status, token, apiFootballKey) {
  await cleanupExpired();
  await sweepFinishedPendingPredictions(token, apiFootballKey);
  try {
    const { data, error } = await supabase
      .from("pronostic_history")
      .select("*")
      .eq("sport", "football")
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
