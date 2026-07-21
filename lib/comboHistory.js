import { supabase } from "./supabaseClient";
import { getLiveMatch } from "./liveMatchCache";
import { fetchRealMatchStats } from "./pronosticVerification";

// BLOC 4.B / BLOC 5 "Suivi dans le temps" — historique global (pas par compte) des
// combinés "Combiné Vision" (table combo_history, voir
// supabase/migrations/0004_combo_history.sql) — même logique que pronostic_history
// pour les pronostics simples (voir lib/pronosticHistory.js) : un combiné est
// enregistré "pending" dès qu'il est généré (voir pages/combine-vision.js), reste "En
// cours" tant que tous ses matchs ne sont pas terminés, passe en "Échec" DÈS QU'UNE
// SEULE sélection est perdue — même si d'autres matchs du combiné ne sont pas encore
// joués (voir BLOC 5, evaluateCombo/verifyLegEarly ci-dessous) — et ne passe en
// "Succès" qu'une fois TOUS ses matchs terminés ET toutes les sélections gagnées.
// Toute erreur Supabase est journalisée mais n'interrompt jamais Combiné Vision : ce
// suivi est un complément, pas une dépendance du reste de la fonctionnalité.

const EXPIRY_DAYS = 5;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;
// Borne le nombre de combinés "pending" revérifiés à chaque chargement de la page —
// un visiteur normal ne doit jamais déclencher un pic d'appels à football-data.org
// (quota partagé de 10 requêtes/minute), même principe que
// lib/pronosticHistory.js (PENDING_REVALIDATE_LIMIT).
const PENDING_REVALIDATE_LIMIT = 10;

// Marchés dont l'issue se déduit directement du score (toujours connu, y compris EN
// DIRECT via lib/liveMatchCache.js) — les autres (corners, tirs, cartons, hors-jeu,
// fautes) nécessitent les vraies statistiques FINALES du match (best-effort,
// API-Football, voir lib/pronosticVerification.js), jamais disponibles avant la fin ;
// les touches ne sont, elles, jamais vérifiables (aucune source ne les fournit, même
// après coup).
const SCORE_DERIVED_STAT_KEYS = new Set(["totalGoals", "totalHome", "totalAway"]);

// Un combiné avec au moins une sélection issue d'un match identifié uniquement par
// API-Football ("af-...") ne peut pas être revérifié plus tard (pas de repli
// football-data.org fiable pour CE match précis) — comme pour les pronostics simples
// (voir lib/pronosticHistory.js, canPersistMatch), on n'alimente alors pas
// l'historique pour ce combiné, sans empêcher son affichage immédiat sur la page.
function canPersistCombo(combo) {
  return (combo.legs || []).every((leg) => leg.matchId && !String(leg.matchId).startsWith("af-"));
}

// Réduit un combiné généré côté client (voir lib/combinedVision.js) à ce qui doit
// être persisté : l'identité de chaque sélection et sa métadonnée de vérification —
// jamais le pronostic complet ni l'objet `match` éphémère.
function toComboRow(combo) {
  const legs = combo.legs.map((leg) => ({
    matchId: leg.matchId,
    homeTeamName: leg.homeTeamName,
    awayTeamName: leg.awayTeamName,
    competitionName: leg.competitionName,
    marketLabel: leg.marketLabel,
    pickLabel: leg.pickLabel,
    verify: leg.verify,
    matchDate: leg.match?.utcDate || null,
  }));
  const matchDate = legs.map((l) => l.matchDate).filter(Boolean).sort().pop() || null;
  return {
    combo_id: combo.id,
    risk_level: combo.riskLevel,
    is_live: combo.isLive,
    legs,
    confidence: combo.confidence,
    match_date: matchDate,
    status: "pending",
  };
}

// Enregistre les combinés fraîchement générés (voir pages/combine-vision.js) —
// upsert avec ignoreDuplicates : un combiné déjà vu (même combo_id, dérivé des mêmes
// matchs + niveau de risque, voir lib/combinedVision.js buildCombo) n'est jamais
// réécrasé, jamais reclassé "pending" une fois déjà résolu.
export async function saveComboPredictions(combos) {
  const toSave = (combos || []).filter(canPersistCombo).map(toComboRow);
  if (toSave.length === 0) return;
  try {
    const { error } = await supabase
      .from("combo_history")
      .upsert(toSave, { onConflict: "combo_id", ignoreDuplicates: true });
    if (error) console.error("Erreur sauvegarde historique combinés:", error.message);
  } catch (e) {
    console.error("Erreur sauvegarde historique combinés:", e.message);
  }
}

// Compare UNE sélection déjà TERMINÉE au vrai résultat final — `true` (réalisée),
// `false` (ratée) ou `null` quand la donnée réelle nécessaire n'est pas disponible
// (jamais un verdict inventé). `realStats` (best-effort, voir fetchRealMatchStats)
// n'est utile que pour les marchés qui ne dépendent pas du score final seul.
function verifyLegFinal(leg, finalScore, realStats) {
  const home = Number(finalScore?.home);
  const away = Number(finalScore?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const v = leg.verify;
  if (!v) return null;

  if (v.type === "winner") {
    const actual = home > away ? "home" : away > home ? "away" : "draw";
    return v.key === actual;
  }

  if (v.type === "line") {
    const realValue = {
      totalGoals: home + away,
      totalHome: home,
      totalAway: away,
      shots: realStats?.shots?.total,
      shotsOnTarget: realStats?.shotsOnTarget?.total,
      corners: realStats?.corners?.total,
      offsides: realStats?.offsides?.total,
      fouls: realStats?.fouls?.total,
      yellowCards: realStats?.yellowCards?.total,
      redCards: realStats?.redCards?.total,
      throwIns: null,
    }[v.statKey];
    if (realValue == null || !Number.isFinite(realValue)) return null;
    return v.side === "Plus" ? realValue > v.line : realValue < v.line;
  }

  return null;
}

// BLOC 5 — "Échec immédiat et automatique" : une sélection peut déjà être décidée
// AVANT la fin de son match, à partir du score EN DIRECT (toujours connu, voir
// lib/liveMatchCache.js) — seulement pour les marchés dérivés du score (Total, Total
// 1, Total 2) : le compte de buts ne peut que monter jusqu'au coup de sifflet final,
// donc un "Moins" déjà dépassé a DÉFINITIVEMENT échoué, et un "Plus" déjà dépassé a
// DÉFINITIVEMENT réussi, sans attendre la fin du match. L'issue du match (1X2) et les
// marchés qui dépendent de statistiques finales (corners, cartons, tirs...) n'ont, eux,
// aucun signal fiable avant la fin réelle du match (un revirement reste toujours
// possible, ou aucune source de décompte en direct n'existe) — ils restent "en
// attente" jusque-là, jamais un verdict anticipé hasardeux.
function verifyLegEarly(leg, currentScore) {
  const v = leg.verify;
  if (!v || v.type !== "line" || !SCORE_DERIVED_STAT_KEYS.has(v.statKey)) return null;
  const home = Number(currentScore?.home);
  const away = Number(currentScore?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const soFar = { totalGoals: home + away, totalHome: home, totalAway: away }[v.statKey];
  if (v.side === "Moins" && soFar > v.line) return false;
  if (v.side === "Plus" && soFar > v.line) return true;
  return null;
}

// "Une seule sélection perdue = combiné perdu, immédiatement" (voir PROMPT BLOC 5) :
// Échec dès qu'UNE ligne est ratée, quel que soit le sort des autres (même encore en
// direct ou pas commencées). Succès seulement si TOUTES les lignes sont confirmées
// réalisées ET tous les matchs terminés. Sinon (rien de perdu, mais pas encore tout
// gagné/terminé) : "En cours" — jamais un verdict global inventé faute de donnée
// complète.
function classifyResults(legResults, allFinished) {
  if (legResults.some((r) => r === false)) return "failure";
  if (allFinished && legResults.length > 0 && legResults.every((r) => r === true)) return "success";
  return "pending";
}

// Calcule, à l'instant présent, le résultat de CHAQUE sélection d'un combiné et le
// statut global qui en découle — utilisé à la fois pour la revérification en base
// (revalidatePending) et pour l'affichage "sélections cochées au fil des matchs"
// (BLOC 5, pages/combine-vision.js) des combinés actuellement affichés. `legResults`
// est une carte matchId -> true/false/null (null = en attente, aucun verdict encore
// possible pour cette sélection précise).
async function evaluateCombo(legs, token, apiFootballKey) {
  const legResults = {};
  let allFinished = true;

  for (const leg of legs) {
    const liveMatch = await getLiveMatch(leg.matchId, token);
    if (!liveMatch) {
      legResults[leg.matchId] = null;
      allFinished = false;
      continue;
    }
    if (liveMatch.status === "FINISHED") {
      const needsRealStats = leg.verify?.type === "line" && !SCORE_DERIVED_STAT_KEYS.has(leg.verify.statKey);
      const realStats = needsRealStats
        ? await fetchRealMatchStats({ homeTeamName: leg.homeTeamName, awayTeamName: leg.awayTeamName, matchDate: leg.matchDate, apiFootballKey })
        : null;
      legResults[leg.matchId] = verifyLegFinal(leg, liveMatch.score?.fullTime, realStats);
    } else {
      allFinished = false;
      legResults[leg.matchId] = verifyLegEarly(leg, liveMatch.score?.fullTime);
    }
  }

  return { status: classifyResults(Object.values(legResults), allFinished), legResults };
}

async function cleanupExpired() {
  const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
  try {
    await supabase.from("combo_history").delete().not("verified_at", "is", null).lt("verified_at", cutoff);
    await supabase.from("combo_history").delete().is("verified_at", null).lt("match_date", cutoff);
  } catch (e) {
    console.error("Erreur nettoyage historique combinés:", e.message);
  }
}

// Revérifie les combinés encore "pending" en base — se déclenche au chargement de la
// page Combiné Vision, comme lib/pronosticHistory.js#revalidatePending. Un combiné
// bascule en base dès que evaluateCombo renvoie un statut définitif ("failure" dès
// une sélection perdue, "success" seulement une fois tout terminé et gagné) — jamais
// besoin d'attendre que TOUS les matchs soient finis pour enregistrer un échec.
async function revalidatePending(token, apiFootballKey) {
  if (!token) return;
  try {
    const { data, error } = await supabase
      .from("combo_history")
      .select("combo_id, legs")
      .eq("status", "pending")
      .order("match_date", { ascending: true })
      .limit(PENDING_REVALIDATE_LIMIT);
    if (error || !data?.length) return;

    await Promise.all(
      data.map(async (row) => {
        const { status } = await evaluateCombo(row.legs, token, apiFootballKey);
        if (status === "pending") return;

        const { error: updateError } = await supabase
          .from("combo_history")
          .update({ status, verified_at: new Date().toISOString() })
          .eq("combo_id", row.combo_id);
        if (updateError) console.error("Erreur vérification historique combinés:", updateError.message);
      })
    );
  } catch (e) {
    console.error("Erreur vérification historique combinés:", e.message);
  }
}

// Taux de réussite par niveau de risque (voir PROMPT "Combinés sûrs : X% réussis") —
// calculé UNIQUEMENT sur les combinés déjà classés Succès/Échec ; les combinés encore
// "pending" ne comptent ni pour, ni contre — jamais un pourcentage gonflé par des
// combinés dont on ne connaît pas encore le résultat.
export async function getSuccessRates() {
  try {
    const { data, error } = await supabase
      .from("combo_history")
      .select("risk_level, status")
      .in("status", ["success", "failure"]);
    if (error || !data) return {};
    const stats = {};
    for (const row of data) {
      stats[row.risk_level] = stats[row.risk_level] || { won: 0, total: 0 };
      stats[row.risk_level].total += 1;
      if (row.status === "success") stats[row.risk_level].won += 1;
    }
    for (const level of Object.keys(stats)) {
      stats[level].pct = Math.round((stats[level].won / stats[level].total) * 1000) / 10;
    }
    return stats;
  } catch (e) {
    console.error("Erreur lecture taux de réussite des combinés:", e.message);
    return {};
  }
}

// BLOC 5 — statut ET progression (sélection par sélection) des combinés actuellement
// affichés, recalculés à l'instant présent (jamais relus tels quels depuis la base,
// qui ne connaît que le dernier statut GLOBAL enregistré) : c'est ce qui permet
// d'afficher "les sélections déjà jouées et gagnées cochées, les autres en attente"
// pendant qu'un combiné est encore "En cours". Un combiné jamais vu auparavant (pas
// encore enregistré, ou POST pas encore terminé) renvoie simplement `undefined` — lu
// côté page comme "En cours", sans sélection cochée pour l'instant.
export async function getComboProgress(comboIds, token, apiFootballKey) {
  if (!comboIds?.length || !token) return {};
  try {
    const { data, error } = await supabase.from("combo_history").select("combo_id, legs").in("combo_id", comboIds);
    if (error || !data) return {};
    const map = {};
    await Promise.all(
      data.map(async (row) => {
        map[row.combo_id] = await evaluateCombo(row.legs, token, apiFootballKey);
      })
    );
    return map;
  } catch (e) {
    console.error("Erreur lecture progression des combinés:", e.message);
    return {};
  }
}

// Nettoie les entrées expirées, revérifie les combinés en attente (échec immédiat dès
// qu'une sélection est perdue, voir BLOC 5), puis renvoie les taux de réussite et la
// progression détaillée des combinés actuellement affichés — voir
// pages/api/combo-history.js.
export async function maintainAndGetComboStats(comboIds, token, apiFootballKey) {
  await cleanupExpired();
  await revalidatePending(token, apiFootballKey);
  const [successRates, progress] = await Promise.all([
    getSuccessRates(),
    getComboProgress(comboIds, token, apiFootballKey),
  ]);
  return { successRates, progress };
}
