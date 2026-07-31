// PROMPT 2 — enrichit chaque bloc de la page pronostics d'une justification courte
// (1-2 phrases) et d'un niveau de confiance (faible/moyen/élevé), à partir des VRAIS
// chiffres déjà calculés pour CE match (lib/pronostic.js et lib/pronosticFromProfiles.js
// produisent la MÊME forme de résultat, quel que soit le modèle utilisé — voir
// pages/api/analyze.js) : jamais un texte générique recopié d'un match à l'autre,
// jamais une valeur inventée. Module unique, réutilisé par les deux modèles plutôt que
// dupliqué (même principe que applyHeadToHead, voir lib/pronosticFromProfiles.js).
import { totalReason, totalTeamReason, splitReason, redCardReason, favoriteSummary, matchProfileLabel, formatGoals } from "./pronostic";

// Seuils calibrés sur la confiance RÉELLE déjà calculée par lib/pronostic.js
// (lineConfidence, modèle de Poisson) pour les lignes Plus/Moins — LINE_CONFIDENCE_THRESHOLD
// (62 %) y sert déjà de repère pour élargir une ligne trop incertaine ; réutilisé ici comme
// frontière moyen/élevé.
function lineConfidenceLevel(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= 62) return "élevé";
  if (pct >= 52) return "moyen";
  return "faible";
}

// Probabilité 1X2 (base neutre 33,3 % pour trois issues, jamais 50 %) : un favori net
// (>55 %) est un signal fort, un simple léger avantage (<40 %) reste peu fiable.
function winProbabilityConfidenceLevel(maxPct) {
  if (maxPct == null || !Number.isFinite(maxPct)) return null;
  if (maxPct >= 55) return "élevé";
  if (maxPct >= 40) return "moyen";
  return "faible";
}

// Score exact le plus probable : la masse de probabilité est répartie sur des dizaines
// de scores possibles (voir buildOutcome), donc même le score en tête dépasse rarement
// 20 % — seuils recalibrés en conséquence, jamais ceux d'une ligne Plus/Moins classique.
function scoreConfidenceLevel(topPct) {
  if (topPct == null || !Number.isFinite(topPct)) return null;
  if (topPct >= 16) return "élevé";
  if (topPct >= 10) return "moyen";
  return "faible";
}

function unavailable(text) {
  return { text, confidence: null };
}

// Un marché peut soit ne pas exposer `available` (ancien modèle, toujours renseigné),
// soit l'exposer explicitement à `false` (Bloc 2, profils réels absents pour cette
// statistique — voir lib/pronosticFromProfiles.js) : jamais traité comme disponible
// par défaut dans ce second cas.
function marketAvailable(m) {
  return Boolean(m) && m.available !== false;
}

function lineJustification({ market, text }) {
  if (!marketAvailable(market)) return unavailable("Indisponible pour ce match.");
  const confidencePct = market.confidence ?? market.lines?.[0]?.confidence;
  return { text, confidence: lineConfidenceLevel(confidencePct) };
}

function riskJustification({ market, text }) {
  if (!marketAvailable(market) || !market.safe) return unavailable("Indisponible pour ce match.");
  return { text, confidence: lineConfidenceLevel(market.safe.confidence) };
}

function statBlockJustification({ statBlock, marketBlock, labelPlural, hName, aName }) {
  if (statBlock?.total == null) {
    return unavailable("Indisponible : aucune source connectée ne fournit cette statistique pour ce match.");
  }
  const text = splitReason(labelPlural, statBlock, hName, aName);
  const confidencePct = marketAvailable(marketBlock?.total) ? marketBlock.total.confidence : null;
  return { text, confidence: lineConfidenceLevel(confidencePct) };
}

// Blocs dont les chiffres suivent l'évolution réelle du match une fois qu'il est en
// direct (voir pages/api/analyze.js, computeLiveOutcome) : probabilité de victoire,
// scores exacts, Total/Total 1/Total 2 — recalculés à CHAQUE appel de cette fonction
// avec les valeurs déjà à jour de `result` (pré-match ou live selon le contexte),
// jamais figés indépendamment des chiffres qu'ils commentent.
export function buildLiveNarrative(result, { homeTeamName, awayTeamName }) {
  const hName = homeTeamName || "Domicile";
  const aName = awayTeamName || "Extérieur";
  const { probabilities, goals, correctScores, markets } = result;

  const maxProb = Math.max(probabilities.home, probabilities.draw, probabilities.away);
  const winProbability = {
    text: favoriteSummaryText(probabilities, goals, hName, aName),
    confidence: winProbabilityConfidenceLevel(maxProb),
  };

  const topScore = correctScores?.[0];
  const correctScoresNarrative = topScore
    ? {
        text: `Score le plus probable : ${topScore.score.replace("-", " - ")}, cohérent avec une moyenne attendue de ${formatGoals(goals.expectedHome)} but(s) pour ${hName} et ${formatGoals(goals.expectedAway)} pour ${aName}.`,
        confidence: scoreConfidenceLevel(topScore.probability),
      }
    : unavailable("Indisponible pour ce match.");

  return {
    winProbability,
    correctScores: correctScoresNarrative,
    totalGoals: lineJustification({ market: markets?.totalGoals, text: totalReason(goals, hName, aName) }),
    totalHome: lineJustification({ market: markets?.totalHome, text: totalTeamReason(hName, goals.expectedHome, aName) }),
    totalAway: lineJustification({ market: markets?.totalAway, text: totalTeamReason(aName, goals.expectedAway, hName) }),
  };
}

function favoriteSummaryText(probabilities, goals, hName, aName) {
  const margin = Math.abs(probabilities.home - probabilities.away);
  if (margin < 8) {
    return `Écart minime entre les deux équipes (${formatGoals(goals.expectedHome)} but(s) attendu(s) pour ${hName} contre ${formatGoals(goals.expectedAway)} pour ${aName}) : issue ouverte, aucun favori net.`;
  }
  const homeFavorite = probabilities.home > probabilities.away;
  const favorite = homeFavorite ? hName : aName;
  const favoritePct = homeFavorite ? probabilities.home : probabilities.away;
  const favoriteGoals = homeFavorite ? goals.expectedHome : goals.expectedAway;
  const opponentGoals = homeFavorite ? goals.expectedAway : goals.expectedHome;
  return `${favorite} part favori(te) (${favoritePct} %), avec ${formatGoals(favoriteGoals)} but(s) attendu(s) contre ${formatGoals(opponentGoals)} pour l'adversaire sur ce match.`;
}

// Blocs FIGÉS avant le match, comme le reste des pronostics (corners, hors-jeu,
// fautes, touches, tirs, tirs cadrés, cartons) — calculés UNE SEULE FOIS ici (voir
// pages/api/analyze.js, computeFreshPrediction) puis persistés avec le reste du
// pronostic (lib/pronosticHistory.js), jamais recalculés pendant le match.
export function buildStaticNarrative(result, { homeTeamName, awayTeamName }) {
  const hName = homeTeamName || "Domicile";
  const aName = awayTeamName || "Extérieur";
  const { extraStats, matchStats, markets } = result;

  return {
    corners: statBlockJustification({ statBlock: extraStats?.corners, marketBlock: matchStats?.corners, labelPlural: "corners", hName, aName }),
    fouls: statBlockJustification({ statBlock: extraStats?.fouls, marketBlock: matchStats?.fouls, labelPlural: "fautes", hName, aName }),
    offsides: statBlockJustification({ statBlock: extraStats?.offsides, marketBlock: matchStats?.offsides, labelPlural: "hors-jeu", hName, aName }),
    throwIns: statBlockJustification({ statBlock: extraStats?.throwIns, marketBlock: matchStats?.throwIns, labelPlural: "touches", hName, aName }),
    shots: lineJustification({ market: markets?.shots, text: splitReasonOrUnavailable(extraStats?.shots, "tirs", hName, aName) }),
    shotsOnTarget: lineJustification({ market: markets?.shotsOnTarget, text: splitReasonOrUnavailable(extraStats?.shotsOnTarget, "tirs cadrés", hName, aName) }),
    yellowCards: riskJustification({ market: markets?.yellowCards, text: splitReasonOrUnavailable(extraStats?.cards?.yellow, "cartons jaunes", hName, aName) }),
    redCards: riskJustification({ market: markets?.redCards, text: redCardReason(extraStats?.raw?.redCardExpected) }),
    preMatchSummary: buildPreMatchSummary(result, { homeTeamName: hName, awayTeamName: aName }),
  };
}

function splitReasonOrUnavailable(stat, labelPlural, hName, aName) {
  if (stat?.total == null) return "Indisponible pour ce match.";
  return splitReason(labelPlural, stat, hName, aName);
}

// Résumé d'avant-match (quelques lignes, en haut de la page) : compare le niveau des
// deux équipes (notes de qualité réelles du Bloc 1 quand disponibles — voir
// lib/teamQualityRatings.js — sinon les buts attendus déjà calculés), leur favori, et
// le scénario le plus probable — jamais la même phrase recopiée d'un match à l'autre,
// toujours dérivé des chiffres réels de CE match.
export function buildPreMatchSummary(result, { homeTeamName, awayTeamName }) {
  const hName = homeTeamName || "Domicile";
  const aName = awayTeamName || "Extérieur";
  const { goals, probabilities, correctScores, qualityRatings } = result;
  const sentences = [];

  const hOverall = qualityRatings?.home?.overall;
  const aOverall = qualityRatings?.away?.overall;
  if (hOverall?.available && aOverall?.available) {
    if (Math.abs(hOverall.value - aOverall.value) < 8) {
      sentences.push(
        `${hName} et ${aName} affichent un niveau global proche cette saison (respectivement ${hOverall.value}/100 et ${aOverall.value}/100 parmi les équipes de la compétition).`
      );
    } else {
      const better = hOverall.value > aOverall.value;
      sentences.push(
        `${better ? hName : aName} présente un niveau global supérieur à ${better ? aName : hName} cette saison (${Math.max(hOverall.value, aOverall.value)}/100 contre ${Math.min(hOverall.value, aOverall.value)}/100 parmi les équipes de la compétition).`
      );
    }
  } else {
    sentences.push(
      `${hName} est attendu(e) autour de ${formatGoals(goals.expectedHome)} but(s) et ${aName} autour de ${formatGoals(goals.expectedAway)} sur ce match, d'après les statistiques réelles récentes des deux équipes.`
    );
  }

  sentences.push(`${favoriteSummary(probabilities, hName, aName)}.`.replace(/^./, (c) => c.toUpperCase()));

  const top = correctScores?.[0];
  const profile = matchProfileLabel(goals.expectedTotal);
  if (top) {
    sentences.push(
      `Scénario le plus probable : ${profile}, environ ${formatGoals(goals.expectedTotal)} but(s) au total, avec le score ${top.score.replace("-", " - ")} en tête des probabilités.`
    );
  }

  return sentences.join(" ");
}
