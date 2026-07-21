import { supabase } from "./supabaseClient";
import { getLiveMatch } from "./liveMatchCache";
import { fetchRealMatchStats } from "./pronosticVerification";

// BLOC 4.B "Suivi dans le temps" — historique global (pas par compte) des combinés
// "Combiné Vision" (table combo_history, voir supabase/migrations/0004_combo_history.sql)
// — même logique que pronostic_history pour les pronostics simples (voir
// lib/pronosticHistory.js) : un combiné est enregistré "pending" dès qu'il est généré
// (voir pages/combine-vision.js), puis classé Succès/Échec une fois TOUS ses matchs
// terminés — "une seule sélection perdue = combiné perdu" (voir PROMPT). Toute erreur
// Supabase est journalisée mais n'interrompt jamais Combiné Vision : ce suivi est un
// complément, pas une dépendance du reste de la fonctionnalité.

const EXPIRY_DAYS = 5;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;
// Borne le nombre de combinés "pending" revérifiés à chaque chargement de la page —
// un visiteur normal ne doit jamais déclencher un pic d'appels à football-data.org
// (quota partagé de 10 requêtes/minute), même principe que
// lib/pronosticHistory.js (PENDING_REVALIDATE_LIMIT).
const PENDING_REVALIDATE_LIMIT = 10;

// Marchés dont l'issue se déduit directement du score final (toujours connu) — les
// autres (corners, tirs, cartons, hors-jeu, fautes) nécessitent les vraies
// statistiques finales du match (best-effort, API-Football, voir
// lib/pronosticVerification.js) ; les touches ne sont, elles, jamais vérifiables
// (aucune source ne les fournit, même après coup).
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

// Compare UNE sélection déjà persistée au vrai résultat final — `true` (réalisée),
// `false` (ratée) ou `null` quand la donnée réelle nécessaire n'est pas disponible
// (jamais un verdict inventé). `realStats` (best-effort, voir fetchRealMatchStats)
// n'est utile que pour les marchés qui n'en dépendent pas du score final seul.
function verifyLegOutcome(leg, finalScore, realStats) {
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

// "Une seule sélection perdue = combiné perdu" (voir PROMPT) : Échec dès qu'UNE ligne
// est ratée, quel que soit le sort des autres. Succès seulement si TOUTES les lignes
// sont confirmées réalisées. Si certaines restent indéterminées (donnée réelle
// indisponible) sans qu'aucune n'ait échoué, le combiné reste "En cours" — jamais un
// verdict global inventé faute de donnée complète.
function classifyCombo(legResults) {
  if (legResults.some((r) => r === false)) return "failure";
  if (legResults.length > 0 && legResults.every((r) => r === true)) return "success";
  return "pending";
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

// Revérifie les combinés encore "pending" : un combiné n'est classable que lorsque
// TOUS ses matchs sont terminés (voir PROMPT "une fois les matchs joués"). Se
// déclenche au chargement de la page Combiné Vision, comme
// lib/pronosticHistory.js#revalidatePending — "sans action de l'utilisateur" au sens
// où aucun clic n'est nécessaire, seulement le fait d'avoir ouvert la page.
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
        const finalScores = {};
        for (const leg of row.legs) {
          const liveMatch = await getLiveMatch(leg.matchId, token);
          if (liveMatch?.status !== "FINISHED") return; // au moins un match pas encore terminé : reste "pending"
          finalScores[leg.matchId] = liveMatch.score?.fullTime || null;
        }

        const realStatsByMatch = {};
        await Promise.all(
          row.legs
            .filter((leg) => leg.verify?.type === "line" && !SCORE_DERIVED_STAT_KEYS.has(leg.verify.statKey))
            .map(async (leg) => {
              if (realStatsByMatch[leg.matchId]) return;
              realStatsByMatch[leg.matchId] = await fetchRealMatchStats({
                homeTeamName: leg.homeTeamName, awayTeamName: leg.awayTeamName, matchDate: leg.matchDate, apiFootballKey,
              });
            })
        );

        const results = row.legs.map((leg) => verifyLegOutcome(leg, finalScores[leg.matchId], realStatsByMatch[leg.matchId]));
        const status = classifyCombo(results);
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

// Statut (pending/success/failure) des combinés actuellement affichés — un combiné
// fraîchement généré n'a le plus souvent jamais été vu auparavant (matchs tirés au
// hasard, voir lib/combinedVision.js) : `undefined` (aucune ligne) se lit alors
// simplement comme "En cours", exactement comme "pending".
export async function getComboStatuses(comboIds) {
  if (!comboIds?.length) return {};
  try {
    const { data, error } = await supabase.from("combo_history").select("combo_id, status").in("combo_id", comboIds);
    if (error || !data) return {};
    const map = {};
    for (const row of data) map[row.combo_id] = row.status;
    return map;
  } catch (e) {
    console.error("Erreur lecture statut des combinés:", e.message);
    return {};
  }
}

// Nettoie les entrées expirées, revérifie les combinés en attente, puis renvoie les
// taux de réussite et le statut des combinés actuellement affichés — voir
// pages/api/combo-history.js.
export async function maintainAndGetComboStats(comboIds, token, apiFootballKey) {
  await cleanupExpired();
  await revalidatePending(token, apiFootballKey);
  const [successRates, statuses] = await Promise.all([getSuccessRates(), getComboStatuses(comboIds)]);
  return { successRates, statuses };
}
