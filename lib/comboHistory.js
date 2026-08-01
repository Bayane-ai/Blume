import { supabaseAnon as supabase } from "./supabaseAnon";
import { getLiveMatch } from "./liveMatchCache";
import { fetchRealMatchStats } from "./pronosticVerification";
import { getGameById as getBasketballGameById, getGameStatistics as getBasketballGameStatistics } from "./sports/basketball/provider";
import { mapGameStatusToBlumeStatus } from "./sports/basketball/mapper";
import { STAT_ALIASES as BASKETBALL_STAT_ALIASES, statisticValue as basketballStatisticValue } from "./sports/basketball/statProfiles";
import { getGameById as getTennisGameById, getGameStatistics as getTennisGameStatistics } from "./sports/tennis/provider";
import { mapMatchToLiveState, mapGameStatistics as mapTennisGameStatistics } from "./sports/tennis/mapper";

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
//
// BLOC 9 (multi-sport) — un combiné peut mélanger football/basket/tennis : chaque
// sélection (`leg`) porte désormais son propre `sport`, et evaluateCombo/
// verifyLegFinal/verifyLegEarly ci-dessous se répartissent le travail par sport,
// exactement comme lib/sports/basketball/pronosticHistory.js et lib/sports/tennis/
// pronosticHistory.js le font déjà chacun pour leurs propres pronostics simples.

const EXPIRY_DAYS = 5;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;
// Borne le nombre de combinés "pending" revérifiés à chaque chargement de la page —
// un visiteur normal ne doit jamais déclencher un pic d'appels aux API (quota
// partagé), même principe que lib/pronosticHistory.js (PENDING_REVALIDATE_LIMIT).
const PENDING_REVALIDATE_LIMIT = 10;

// Marchés dont l'issue se déduit directement du score (toujours connu, y compris EN
// DIRECT) — les autres nécessitent les vraies statistiques FINALES du match
// (best-effort), jamais disponibles avant la fin.
const FOOTBALL_SCORE_DERIVED_STAT_KEYS = new Set(["totalGoals", "totalHome", "totalAway"]);
const BASKETBALL_SCORE_DERIVED_STAT_KEYS = new Set(["totalPoints", "totalHome", "totalAway"]);
// Tennis : le "score" en direct (sets gagnés) n'est PAS la même grandeur que les
// totaux de jeux (voir totalGames* ci-dessous, dérivés du vrai décompte de jeux par
// set) — jamais de verdict anticipé pour le tennis, voir verifyLegEarly.

// Un combiné avec au moins une sélection issue d'un match identifié uniquement par
// API-Football ("af-...") ne peut pas être revérifié plus tard (pas de repli
// football-data.org fiable pour CE match précis) — comme pour les pronostics simples
// (voir lib/pronosticHistory.js, canPersistMatch), on n'alimente alors pas
// l'historique pour ce combiné, sans empêcher son affichage immédiat sur la page. Les
// ids basket ("bk-...")/tennis ("tn-...") sont, eux, TOUJOURS des ids réels connus
// (même précédent que lib/sports/basketball/pronosticHistory.js et lib/sports/tennis/
// pronosticHistory.js) : jamais exclus pour cette raison.
function canPersistCombo(combo) {
  return (combo.legs || []).every((leg) => leg.matchId && !String(leg.matchId).startsWith("af-"));
}

// Réduit un combiné généré côté client (voir lib/combinedVision.js) à ce qui doit
// être persisté : l'identité de chaque sélection (dont son sport) et sa métadonnée de
// vérification — jamais le pronostic complet ni l'objet `match` éphémère.
function toComboRow(combo) {
  const legs = combo.legs.map((leg) => ({
    matchId: leg.matchId,
    sport: leg.sport || "football",
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

function sumOrNull(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? a + b : null;
}

// Vrai décompte de jeux total par set (tennis uniquement) — même convention que
// lib/sports/tennis/pronosticHistory.js#realGameTotals (dupliquée ici volontairement,
// même principe que le reste du module tennis : chaque fichier reste testable en
// isolation, voir lib/sports/tennis/timeline.js pour le même choix).
function tennisGameTotalsFromSets(sets) {
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
  return any ? { home, away, total: home + away } : { home: null, away: null, total: null };
}

// État réel ACTUEL du match d'UNE sélection, quel que soit son sport — `null` si la
// clé API du sport manquante ou si le match est introuvable (jamais un état inventé).
async function fetchMatchState(leg, ctx) {
  const sport = leg.sport || "football";

  if (sport === "basketball") {
    if (!ctx.basketballApiKey) return null;
    const realId = String(leg.matchId).replace(/^bk-/, "");
    const game = await getBasketballGameById(realId, ctx.basketballApiKey);
    if (!game) return null;
    return {
      status: mapGameStatusToBlumeStatus(game.status?.short),
      score: { home: game.scores?.home?.total ?? null, away: game.scores?.away?.total ?? null },
      raw: game,
    };
  }

  if (sport === "tennis") {
    if (!ctx.tennisApiKey) return null;
    const realId = String(leg.matchId).replace(/^tn-/, "");
    const game = await getTennisGameById(realId, ctx.tennisApiKey);
    if (!game) return null;
    const liveState = mapMatchToLiveState(game);
    return {
      status: liveState.status,
      score: liveState.score?.fullTime || null,
      games: tennisGameTotalsFromSets(liveState.sets),
      raw: game,
    };
  }

  // football (par défaut)
  if (!ctx.token) return null;
  const liveMatch = await getLiveMatch(leg.matchId, ctx.token);
  if (!liveMatch) return null;
  return { status: liveMatch.status, score: liveMatch.score?.fullTime || null, raw: liveMatch };
}

// Vraies statistiques FINALES nécessaires à UNE sélection "line" qui ne se déduit pas
// directement du score/des totaux déjà connus — `null` en silence si la clé API du
// sport manque, si la source échoue, ou si le marché n'en a simplement pas besoin
// (jamais une exception qui interromprait la vérification du reste du combiné).
async function fetchRealStatsForLeg(leg, state, ctx) {
  const v = leg.verify;
  if (!v || v.type !== "line") return null;
  const sport = leg.sport || "football";

  if (sport === "football") {
    if (FOOTBALL_SCORE_DERIVED_STAT_KEYS.has(v.statKey)) return null;
    return fetchRealMatchStats({ homeTeamName: leg.homeTeamName, awayTeamName: leg.awayTeamName, matchDate: leg.matchDate, apiFootballKey: ctx.apiFootballKey });
  }

  if (sport === "basketball") {
    if (BASKETBALL_SCORE_DERIVED_STAT_KEYS.has(v.statKey) || !ctx.basketballApiKey || !state?.raw?.id) return null;
    try {
      const stats = await getBasketballGameStatistics(state.raw.id, ctx.basketballApiKey);
      const homeId = state.raw?.teams?.home?.id;
      const awayId = state.raw?.teams?.away?.id;
      const homeEntry = Array.isArray(stats) ? stats.find((s) => String(s?.team?.id) === String(homeId)) : null;
      const awayEntry = Array.isArray(stats) ? stats.find((s) => String(s?.team?.id) === String(awayId)) : null;
      const pick = (entry, aliases) => basketballStatisticValue(entry?.statistics, aliases);
      return {
        reboundsTotal: sumOrNull(pick(homeEntry, BASKETBALL_STAT_ALIASES.rebounds), pick(awayEntry, BASKETBALL_STAT_ALIASES.rebounds)),
        assistsTotal: sumOrNull(pick(homeEntry, BASKETBALL_STAT_ALIASES.assists), pick(awayEntry, BASKETBALL_STAT_ALIASES.assists)),
        threePointersTotal: sumOrNull(pick(homeEntry, BASKETBALL_STAT_ALIASES.threePointersMade), pick(awayEntry, BASKETBALL_STAT_ALIASES.threePointersMade)),
        foulsTotal: sumOrNull(pick(homeEntry, BASKETBALL_STAT_ALIASES.fouls), pick(awayEntry, BASKETBALL_STAT_ALIASES.fouls)),
        turnoversTotal: sumOrNull(pick(homeEntry, BASKETBALL_STAT_ALIASES.turnovers), pick(awayEntry, BASKETBALL_STAT_ALIASES.turnovers)),
        freeThrowsTotal: sumOrNull(pick(homeEntry, BASKETBALL_STAT_ALIASES.freeThrowsMade), pick(awayEntry, BASKETBALL_STAT_ALIASES.freeThrowsMade)),
      };
    } catch (e) {
      console.error("Erreur statistiques finales basket (combiné):", e.message);
      return null;
    }
  }

  if (sport === "tennis") {
    // Totaux de jeux : dérivés de `state.games` (voir fetchMatchState), jamais un
    // second appel réseau pour la même donnée.
    if (v.statKey === "totalGames" || v.statKey === "totalGamesHome" || v.statKey === "totalGamesAway") return null;
    if (!ctx.tennisApiKey || !state?.raw?.id) return null;
    try {
      const raw = await getTennisGameStatistics(state.raw.id, ctx.tennisApiKey);
      const homeId = state.raw?.teams?.home?.id ?? state.raw?.players?.home?.id ?? null;
      const mapped = mapTennisGameStatistics(raw, homeId);
      return {
        acesTotal: sumOrNull(mapped?.home?.aces?.value, mapped?.away?.aces?.value),
        acesHome: mapped?.home?.aces?.value ?? null,
        acesAway: mapped?.away?.aces?.value ?? null,
      };
    } catch (e) {
      console.error("Erreur statistiques finales tennis (combiné):", e.message);
      return null;
    }
  }

  return null;
}

// Vraie valeur atteinte pour `statKey`, quel que soit le sport — `null` quand la
// donnée réelle nécessaire manque (jamais une valeur inventée).
function resolveRealValue(sport, statKey, { score, state, realStats }) {
  const home = Number(score?.home);
  const away = Number(score?.away);
  const hasScore = Number.isFinite(home) && Number.isFinite(away);

  if (sport === "football") {
    return {
      totalGoals: hasScore ? home + away : null,
      totalHome: hasScore ? home : null,
      totalAway: hasScore ? away : null,
      shots: realStats?.shots?.total, shotsOnTarget: realStats?.shotsOnTarget?.total,
      corners: realStats?.corners?.total, offsides: realStats?.offsides?.total,
      fouls: realStats?.fouls?.total, yellowCards: realStats?.yellowCards?.total,
      redCards: realStats?.redCards?.total, throwIns: null,
    }[statKey];
  }
  if (sport === "basketball") {
    return {
      totalPoints: hasScore ? home + away : null, totalHome: hasScore ? home : null, totalAway: hasScore ? away : null,
      reboundsTotal: realStats?.reboundsTotal, assistsTotal: realStats?.assistsTotal,
      threePointersTotal: realStats?.threePointersTotal, foulsTotal: realStats?.foulsTotal,
      turnoversTotal: realStats?.turnoversTotal, freeThrowsTotal: realStats?.freeThrowsTotal,
    }[statKey];
  }
  if (sport === "tennis") {
    return {
      totalGames: state?.games?.total, totalGamesHome: state?.games?.home, totalGamesAway: state?.games?.away,
      acesTotal: realStats?.acesTotal, acesHome: realStats?.acesHome, acesAway: realStats?.acesAway,
    }[statKey];
  }
  return null;
}

// Compare UNE sélection déjà TERMINÉE au vrai résultat final — `true` (réalisée),
// `false` (ratée) ou `null` quand la donnée réelle nécessaire n'est pas disponible
// (jamais un verdict inventé). `realStats` (best-effort) n'est utile que pour les
// marchés qui ne dépendent pas du score final seul.
function verifyLegFinal(leg, state, realStats) {
  const sport = leg.sport || "football";
  const home = Number(state?.score?.home);
  const away = Number(state?.score?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const v = leg.verify;
  if (!v) return null;

  if (v.type === "winner") {
    const actual = home > away ? "home" : away > home ? "away" : "draw";
    return v.key === actual;
  }

  if (v.type === "line") {
    const realValue = resolveRealValue(sport, v.statKey, { score: state.score, state, realStats });
    if (realValue == null || !Number.isFinite(realValue)) return null;
    return v.side === "Plus" ? realValue > v.line : realValue < v.line;
  }

  return null;
}

// BLOC 5 — "Échec immédiat et automatique" : une sélection peut déjà être décidée
// AVANT la fin de son match, à partir du score EN DIRECT — seulement pour les
// marchés dérivés du score total en direct (football : Total/Total 1/Total 2 buts ;
// basket : Total/Total 1/Total 2 points) : ce compte ne peut que monter jusqu'à la
// fin du match, donc un "Moins" déjà dépassé a DÉFINITIVEMENT échoué, et un "Plus"
// déjà dépassé a DÉFINITIVEMENT réussi, sans attendre la fin du match. L'issue du
// match et les marchés qui dépendent de statistiques finales (corners, cartons,
// tirs, rebonds, aces...) n'ont, eux, aucun signal fiable avant la fin réelle du
// match — ils restent "en attente" jusque-là, jamais un verdict anticipé hasardeux.
// BLOC 9 — le tennis n'a JAMAIS de verdict anticipé : son "score" en direct (sets
// gagnés) n'est pas la même grandeur que ses totaux de jeux, contrairement au
// football/basket où le score EST directement le total suivi.
function verifyLegEarly(leg, state) {
  const sport = leg.sport || "football";
  const v = leg.verify;
  if (!v || v.type !== "line") return null;
  const home = Number(state?.score?.home);
  const away = Number(state?.score?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

  let soFar = null;
  if (sport === "football" && FOOTBALL_SCORE_DERIVED_STAT_KEYS.has(v.statKey)) {
    soFar = { totalGoals: home + away, totalHome: home, totalAway: away }[v.statKey];
  } else if (sport === "basketball" && BASKETBALL_SCORE_DERIVED_STAT_KEYS.has(v.statKey)) {
    soFar = { totalPoints: home + away, totalHome: home, totalAway: away }[v.statKey];
  } else {
    return null;
  }
  if (soFar == null) return null;
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
// possible pour cette sélection précise). `ctx` = { token, apiFootballKey,
// basketballApiKey, tennisApiKey } (bloc 9 : une clé de sport manquante laisse
// simplement CE sport-là "en attente", sans jamais bloquer les autres sélections).
async function evaluateCombo(legs, ctx) {
  const legResults = {};
  let allFinished = true;

  for (const leg of legs) {
    const state = await fetchMatchState(leg, ctx);
    if (!state) {
      legResults[leg.matchId] = null;
      allFinished = false;
      continue;
    }
    if (state.status === "FINISHED") {
      const realStats = await fetchRealStatsForLeg(leg, state, ctx);
      legResults[leg.matchId] = verifyLegFinal(leg, state, realStats);
    } else {
      allFinished = false;
      legResults[leg.matchId] = verifyLegEarly(leg, state);
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
// BLOC 9 — `ctx` regroupe les clés des 3 sports (voir maintainAndGetComboStats) : un
// combiné mixte n'est jamais bloqué si un seul sport manque de clé, ses autres
// sélections restent quand même vérifiables.
async function revalidatePending(ctx) {
  if (!ctx.token && !ctx.basketballApiKey && !ctx.tennisApiKey) return;
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
        const { status } = await evaluateCombo(row.legs, ctx);
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
export async function getComboProgress(comboIds, ctx) {
  if (!comboIds?.length || (!ctx.token && !ctx.basketballApiKey && !ctx.tennisApiKey)) return {};
  try {
    const { data, error } = await supabase.from("combo_history").select("combo_id, legs").in("combo_id", comboIds);
    if (error || !data) return {};
    const map = {};
    await Promise.all(
      data.map(async (row) => {
        map[row.combo_id] = await evaluateCombo(row.legs, ctx);
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
// pages/api/combo-history.js. `ctx` = { token, apiFootballKey, basketballApiKey,
// tennisApiKey } (bloc 9, multi-sport).
export async function maintainAndGetComboStats(comboIds, ctx) {
  await cleanupExpired();
  await revalidatePending(ctx);
  const [successRates, progress] = await Promise.all([
    getSuccessRates(),
    getComboProgress(comboIds, ctx),
  ]);
  return { successRates, progress };
}
