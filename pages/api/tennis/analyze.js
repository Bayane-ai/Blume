// Équivalent tennis de pages/api/analyze.js (football)/pages/api/basketball/
// analyze.js — calcule les 4 lignes de pronostic (voir lib/sports/tennis/
// livePronostic.js) à partir du classement des deux joueurs (GET /players/{id}, si
// Live Tennis API le fournit) et les recalcule EN DIRECT à partir du vrai score en
// cours (GET /matches/{id}/score). Fige le pronostic une seule fois (lib/sports/
// tennis/pronosticHistory.js, même table que football/basket) et le vérifie
// automatiquement dès que le match est constaté terminé.
import { getTennisApiKey, getMatchScore, getPlayer } from "../../../lib/sports/tennis/provider";
import { mapMatchToLiveState } from "../../../lib/sports/tennis/mapper";
import { buildModelState, computeLivePronostic, deriveLiveSetsState, buildTennisSelectionCandidates } from "../../../lib/sports/tennis/livePronostic";
import {
  getFrozenPrediction, saveFrozenPrediction, verifyFrozenPrediction, canPersistMatch,
} from "../../../lib/sports/tennis/pronosticHistory";

// Les ids transmis par components/MatchCard.js#matchHref portent le préfixe "tn-"
// (voir lib/sports/tennis/mapper.js) — jamais envoyés tels quels à l'API.
function stripPrefix(id) {
  if (typeof id !== "string") return null;
  const n = id.startsWith("tn-") ? id.slice(3) : id;
  return n || null;
}

// Grand Chelem masculin = 5 sets gagnants ; tout le reste = 3 — jamais deviné à partir
// d'un champ absent : seule une catégorie explicitement reconnue bascule à 5 (voir
// lib/sports/tennis/livePronostic.js#buildModelState, par défaut 3 sinon).
function determineBestOf(category) {
  const text = (category || "").toLowerCase();
  const isGrandSlam = /grand\s*slam|grand\s*chelem/.test(text);
  const isWTA = /wta/.test(text);
  return isGrandSlam && !isWTA ? 5 : 3;
}

export default async function handler(req, res) {
  const apiKey = getTennisApiKey();
  if (!apiKey) return res.status(500).json({ available: false, error: "Clé API tennis manquante" });

  const { matchId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, category } = req.query;
  const realId = stripPrefix(matchId);
  if (!realId) {
    return res.status(400).json({ available: false, error: "Identifiant de match manquant" });
  }

  try {
    const bestOf = determineBestOf(category);

    // Score réel du match — toujours lu depuis l'API, jamais transmis par le client
    // (même principe que les autres sports). `null` en repli gracieux (quota, panne
    // passagère) : le pronostic reste calculable à partir du seul classement.
    const rawScore = await getMatchScore(realId, apiKey);
    const liveMatch = rawScore ? mapMatchToLiveState({ id: realId, status: rawScore?.status }, rawScore) : null;
    const status = liveMatch?.status || "SCHEDULED";
    const isLive = status === "IN_PLAY" || status === "PAUSED";
    const finalScore = liveMatch?.score?.fullTime || null;

    let result;
    const frozen = await getFrozenPrediction(matchId);
    if (frozen) {
      result = { available: true, ...frozen.prediction };
      if (frozen.status === "success" || frozen.status === "failure") result.historyStatus = frozen.status;
    } else {
      // Classement des deux joueurs (GET /players/{id}, seule donnée "joueur"
      // disponible sur ce plan — voir lib/sports/tennis/provider.js) : `null` chacun
      // si absent, le modèle retombe alors sur une base neutre (jamais un classement
      // inventé, voir livePronostic.js#buildModelState).
      const homeRealId = stripPrefix(homeTeamId);
      const awayRealId = stripPrefix(awayTeamId);
      const [homePlayer, awayPlayer] = await Promise.all([
        homeRealId ? getPlayer(homeRealId, apiKey) : Promise.resolve(null),
        awayRealId ? getPlayer(awayRealId, apiKey) : Promise.resolve(null),
      ]);
      const homeRanking = Number.isFinite(homePlayer?.ranking) ? homePlayer.ranking : Number(homePlayer?.ranking) || null;
      const awayRanking = Number.isFinite(awayPlayer?.ranking) ? awayPlayer.ranking : Number(awayPlayer?.ranking) || null;
      const modelState = buildModelState({ homeRanking, awayRanking, bestOf });
      const overlay = computeLivePronostic({ modelState, liveState: null });

      result = {
        available: true,
        bestOf,
        home: { name: homeTeamName || "Joueur 1", ranking: homeRanking },
        away: { name: awayTeamName || "Joueur 2", ranking: awayRanking },
        probabilities: overlay.probabilities,
        currentSetProbabilities: overlay.currentSetProbabilities,
        gameTotals: overlay.gameTotals,
        totalSets: overlay.totalSets,
        modelState,
        selectionCandidates: buildTennisSelectionCandidates({
          probabilities: overlay.probabilities, homeTeamName, awayTeamName,
          gameTotals: overlay.gameTotals, totalSets: overlay.totalSets,
        }),
        note: "Estimation statistique (modèle de Markov jeu → set → match) basée sur le classement des deux joueurs (quand connu) et le score en direct — Live Tennis API (plan gratuit) ne fournit ni historique ni statistiques de service/retour réelles.",
      };

      if (canPersistMatch(matchId) && homeTeamName && awayTeamName) {
        const justClassified = await saveFrozenPrediction({
          matchId, homeTeamName, awayTeamName, matchDate: liveMatch?.utcDate || null,
          result, matchStatus: status, finalScore, finalSets: liveMatch?.sets || null,
        });
        if (justClassified) result = { ...result, ...justClassified.prediction, historyStatus: justClassified.status };
      }
    }

    // RECALCUL EN DIRECT : les 4 lignes suivent le score réel pendant que le match est
    // suivi (contrairement au football/basket, tout ici est "en direct" — il n'y a pas
    // de bloc figé séparé, voir lib/sports/tennis/livePronostic.js).
    if (isLive && liveMatch) {
      const liveState = deriveLiveSetsState(liveMatch.sets || []);
      const overlay = computeLivePronostic({ modelState: result.modelState, liveState });
      result.probabilities = overlay.probabilities;
      result.currentSetProbabilities = overlay.currentSetProbabilities;
      result.gameTotals = overlay.gameTotals;
      result.totalSets = overlay.totalSets;
    }

    result.matchStatus = status;
    result.matchScore = finalScore;
    result.matchMinute = liveMatch?.minute || null;
    result.matchPeriod = liveMatch?.period || null;
    result.sets = liveMatch?.sets && liveMatch.sets.length > 0 ? liveMatch.sets : null;
    result.server = liveMatch?.server || null;
    result.live = Boolean(isLive);

    // Compte-rendu de fin de match : dès que le match est constaté "FINISHED",
    // compare le pronostic FIGÉ au vrai résultat — automatique, idempotent.
    if (status === "FINISHED" && canPersistMatch(matchId) && !result.historyStatus) {
      try {
        const justVerified = await verifyFrozenPrediction(matchId, finalScore, liveMatch?.sets || null);
        if (justVerified) result = { ...result, ...justVerified.prediction, historyStatus: justVerified.status };
      } catch (e) {
        console.error("Erreur compte-rendu de fin de match (tennis):", e.message);
      }
    }

    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=20");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ available: false, error: e.message });
  }
}
