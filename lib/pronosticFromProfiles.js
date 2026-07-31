// BLOC 2 — génère les lignes de pronostics d'un match en croisant les DEUX profils
// réels d'équipe du Bloc 1 (lib/teamStatProfiles.js) : l'attaque de l'équipe à
// domicile (son profil DOMICILE) contre la défense de l'équipe extérieure (son profil
// EXTÉRIEUR), et réciproquement — jamais une constante partagée entre matchs (voir
// lib/pronostic.js, qui reste la source de vérité pour le modèle de Poisson et le
// format des lignes, ici réutilisés tels quels, jamais dupliqués).
//
// Produit EXACTEMENT la même forme que computePronostic (extraStats/markets/
// matchStats/goals/probabilities/correctScores/selectionCandidates) : aucun
// composant d'affichage n'a besoin de changer — seule la SOURCE des chiffres change.
// Utilisé uniquement quand les DEUX profils d'équipe sont réellement disponibles
// (voir pages/api/analyze.js) ; sinon, le match retombe entièrement sur
// computePronostic (classement/forme récente), jamais un mélange des deux sources au
// sein d'un même match.
import {
  scoreMatrix, buildOutcome, overUnderLine, riskLines, rangeFromShare,
  buildSelectionCandidates, round1, round2, applyHeadToHead,
} from "./pronostic";

// Même proportion que lib/pronostic.js (FIRST_HALF_SHARE) — part du jeu qui se
// déroule statistiquement en 1ère mi-temps — mais appliquée ici à un total désormais
// dérivé des VRAIS profils d'équipe (différent d'un match à l'autre), jamais un total
// fixe : la ligne "1ère mi-temps" varie donc bien, elle aussi, de match en match.
const FIRST_HALF_SHARE = 0.46;

function safeValue(field) {
  return field?.available ? field.value : null;
}

function averageAvailable(values) {
  const usable = values.filter((v) => v != null && Number.isFinite(v));
  if (!usable.length) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

// Confronte l'attaque d'une équipe (SA propre moyenne "pour", à SON lieu dans ce
// match) à la défense de l'adversaire (SA propre moyenne "contre", à SON lieu) —
// moyenne des deux signaux réels quand les deux sont disponibles, repli sur celui qui
// l'est si un seul l'est, indisponible si aucun des deux ne l'est. Même principe que
// lib/pronostic.js#resolveFullMatchLambdas (attaque+défense moyennées), mais à partir
// des VRAIS profils Bloc 1 plutôt que du classement.
function crossExpectation(attackField, defenseField) {
  return averageAvailable([safeValue(attackField), safeValue(defenseField)]);
}

// Deux valeurs requises pour un total honnête (jamais une seule équipe qui ferait
// paraître le match anormalement "calme") — indisponible si l'une des deux manque.
function sumRequired(values) {
  if (values.some((v) => v == null || !Number.isFinite(v))) return null;
  return values.reduce((a, b) => a + b, 0);
}

function halfOf(total) {
  return total == null ? null : total * FIRST_HALF_SHARE;
}

// Ligne "Plus/Moins de X,5" à partir d'un total qui peut être indisponible — jamais
// une ligne fabriquée à partir d'une absence de donnée traitée comme zéro (voir
// lib/pronostic.js#buildSelectionCandidates pour le même principe côté Combiné Vision).
function lineOrUnavailable(total, opts) {
  if (total == null || !Number.isFinite(total)) return { available: false };
  return { available: true, ...overUnderLine(total, opts) };
}

function riskLinesOrUnavailable(total, opts) {
  if (total == null || !Number.isFinite(total)) return { available: false };
  return { available: true, ...riskLines(total, opts) };
}

// Bloc "Total match / Total 1 / Total 2 / 1ère mi-temps" (voir components/
// LiveStatBlock.js) — ici, Total 1/Total 2 viennent directement des VRAIES valeurs
// par équipe (jamais une répartition domicile/extérieur déduite d'un ratio unique
// partagé par toutes les statistiques du match, contrairement à l'ancien modèle) :
// deux statistiques différentes d'un même match peuvent donc avoir des répartitions
// très différentes, comme dans la réalité.
function buildStatBlockFromValues({ total, home, away }) {
  return {
    total: lineOrUnavailable(total),
    home: lineOrUnavailable(home),
    away: lineOrUnavailable(away),
    half: { label: "1ère mi-temps", market: lineOrUnavailable(halfOf(total)) },
  };
}

// Range affichable ("environ 8-10") à partir d'un total qui peut être indisponible —
// jamais un intervalle fabriqué autour de zéro.
function rangeOrNull(total) {
  return total == null ? null : rangeFromShare(round1(total) === 0 ? 0 : total);
}

export function computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName, awayTeamName, h2h = null }) {
  if (!homeProfile?.available || !awayProfile?.available) {
    return { available: false, reason: "profil d'équipe indisponible" };
  }

  const home = homeProfile.home; // profil DOMICILE de l'équipe qui reçoit
  const away = awayProfile.away; // profil EXTÉRIEUR de l'équipe qui se déplace

  // Buts : attaque domicile x défense extérieure, et réciproquement.
  const expectedHomeGoals = crossExpectation(home.goalsFor, away.goalsAgainst);
  const expectedAwayGoals = crossExpectation(away.goalsFor, home.goalsAgainst);
  if (expectedHomeGoals == null || expectedAwayGoals == null) {
    return { available: false, reason: "buts indisponibles pour au moins une équipe" };
  }
  // Contexte (PROMPT 1) : les vraies confrontations directes récentes entre CES deux
  // équipes (lib/headToHead.js), quand l'API en fournit assez, affinent les buts
  // attendus déjà croisés ci-dessus — même mécanisme que l'ancien modèle
  // (lib/pronostic.js#applyHeadToHead, réutilisé tel quel, jamais dupliqué). Un poids
  // volontairement minoritaire : les vrais profils d'équipe (Bloc 1) restent le
  // signal principal, l'historique direct (souvent ancien) ne fait qu'ajuster à la
  // marge.
  const h2hResult = applyHeadToHead(Math.max(0.15, expectedHomeGoals), Math.max(0.15, expectedAwayGoals), h2h);
  const lambdaHome = Math.max(0.15, h2hResult.lambdaHome);
  const lambdaAway = Math.max(0.15, h2hResult.lambdaAway);
  const h2hUsed = h2hResult.used;

  const matrix = scoreMatrix(lambdaHome, lambdaAway);
  const outcome = buildOutcome({ matrix });

  const goals = {
    expectedHome: round2(lambdaHome),
    expectedAway: round2(lambdaAway),
    expectedTotal: round2(lambdaHome + lambdaAway),
    over25: outcome.over25,
    under25: outcome.under25,
    bttsYes: outcome.bttsYes,
    bttsNo: outcome.bttsNo,
  };

  // Corners obtenus par chaque équipe : attaque (obtenus) x défense adverse (concédés).
  const homeCorners = crossExpectation(home.cornersFor, away.cornersAgainst);
  const awayCorners = crossExpectation(away.cornersFor, home.cornersAgainst);
  const cornersTotal = sumRequired([homeCorners, awayCorners]);

  // Fautes commises par chaque équipe : tendance à fauter x tendance de l'adversaire à
  // en subir (l'équipe qui presse le plus l'adversaire lui en fait souvent commettre
  // plus, et inversement).
  const homeFouls = crossExpectation(home.foulsCommitted, away.foulsSuffered);
  const awayFouls = crossExpectation(away.foulsCommitted, home.foulsSuffered);
  const foulsTotal = sumRequired([homeFouls, awayFouls]);

  // Touches (rentrées en touche) : même logique exacte que les fautes ci-dessus — mais
  // aucune source connectée (football-data.org, API-Football) ne fournit jamais cette
  // statistique, même pour un match terminé (déjà établi dans lib/teamStatProfiles.js
  // et lib/pronosticVerification.js) : ces champs sont donc TOUJOURS `available:
  // false` avec les profils actuels, jamais une valeur inventée pour combler ce vide.
  const homeTouches = crossExpectation(home.touches, away.touches);
  const awayTouches = crossExpectation(away.touches, home.touches);
  const touchesTotal = sumRequired([homeTouches, awayTouches]);

  // Hors-jeu : pas de paire pour/contre dans le profil (une seule mesure par équipe,
  // voir lib/teamStatProfiles.js) — total = somme des deux propres moyennes.
  const homeOffsides = safeValue(home.offsides);
  const awayOffsides = safeValue(away.offsides);
  const offsidesTotal = sumRequired([homeOffsides, awayOffsides]);

  // Tirs / tirs cadrés / cartons : une seule mesure par équipe (pas de paire pour/
  // contre) — total = somme des deux propres moyennes, ligne match entier uniquement
  // (aucune 1ère mi-temps demandée pour ces quatre-là).
  const shotsTotal = sumRequired([safeValue(home.shots), safeValue(away.shots)]);
  const shotsOnTargetTotal = sumRequired([safeValue(home.shotsOnTarget), safeValue(away.shotsOnTarget)]);
  const yellowCardsTotal = sumRequired([safeValue(home.yellowCards), safeValue(away.yellowCards)]);
  const redCardsTotal = sumRequired([safeValue(home.redCards), safeValue(away.redCards)]);

  const extraStats = {
    corners: { home: homeCorners, away: awayCorners, total: cornersTotal, range: rangeOrNull(cornersTotal) },
    shots: { home: safeValue(home.shots), away: safeValue(away.shots), total: shotsTotal, range: rangeOrNull(shotsTotal) },
    shotsOnTarget: {
      home: safeValue(home.shotsOnTarget), away: safeValue(away.shotsOnTarget),
      total: shotsOnTargetTotal, range: rangeOrNull(shotsOnTargetTotal),
    },
    cards: { yellow: { home: safeValue(home.yellowCards), away: safeValue(away.yellowCards), total: yellowCardsTotal } },
    offsides: { home: homeOffsides, away: awayOffsides, total: offsidesTotal, range: rangeOrNull(offsidesTotal) },
    fouls: { home: homeFouls, away: awayFouls, total: foulsTotal, range: rangeOrNull(foulsTotal) },
    throwIns: { home: homeTouches, away: awayTouches, total: touchesTotal, range: rangeOrNull(touchesTotal) },
    raw: {
      cornersTotal, shotsTotal, shotsOnTargetTotal, yellowCardsTotal,
      redCardExpected: redCardsTotal, offsidesTotal, foulsTotal, throwInsTotal: touchesTotal,
    },
  };

  const markets = {
    totalGoals: overUnderLine(lambdaHome + lambdaAway, { withMargin: true }),
    totalHome: overUnderLine(lambdaHome, { withMargin: true }),
    totalAway: overUnderLine(lambdaAway, { withMargin: true }),
    shots: lineOrUnavailable(shotsTotal),
    shotsOnTarget: lineOrUnavailable(shotsOnTargetTotal),
    yellowCards: riskLinesOrUnavailable(yellowCardsTotal),
    redCards: riskLinesOrUnavailable(redCardsTotal),
  };

  const matchStats = {
    corners: buildStatBlockFromValues({ total: cornersTotal, home: homeCorners, away: awayCorners }),
    offsides: buildStatBlockFromValues({ total: offsidesTotal, home: homeOffsides, away: awayOffsides }),
    fouls: buildStatBlockFromValues({ total: foulsTotal, home: homeFouls, away: awayFouls }),
    throwIns: buildStatBlockFromValues({ total: touchesTotal, home: homeTouches, away: awayTouches }),
  };

  const homeCtx = { name: homeTeamName, position: null, points: null, form: null };
  const awayCtx = { name: awayTeamName, position: null, points: null, form: null };

  return {
    available: true,
    live: false,
    home: { ...homeCtx, source: "profil d'équipe (Bloc 1)" },
    away: { ...awayCtx, source: "profil d'équipe (Bloc 1)" },
    probabilities: outcome.probabilities,
    goals,
    correctScores: outcome.topScores,
    extraStats,
    markets,
    matchStats,
    selectionCandidates: buildSelectionCandidates({
      probabilities: outcome.probabilities, homeTeamName, awayTeamName, markets, extraStats,
      home: homeCtx, away: awayCtx, goals,
    }),
    note: `Estimation statistique (modèle de Poisson) basée sur les vrais matchs récents de chaque équipe, domicile/extérieur — pas une IA.`,
    h2hUsed,
    // PROMPT 2 (lib/matchNarrative.js) : notes de qualité réelles du Bloc 1 (voir
    // lib/teamQualityRatings.js), transmises telles quelles pour enrichir le résumé
    // d'avant-match — `null` pour chaque équipe tant qu'aucun profil n'a encore été
    // calculé pour elle (jamais une note inventée).
    qualityRatings: { home: homeProfile.qualityRatings || null, away: awayProfile.qualityRatings || null },
    statsNote:
      "Corners, tirs, fautes, hors-jeu et cartons sont calculés à partir des vrais matchs récents de chaque équipe (domicile/extérieur), pas d'une moyenne partagée. Les touches (rentrées en touche) restent indisponibles : aucune source connectée ne fournit cette statistique, même après un match terminé.",
    liveStatNote:
      "Calculées une seule fois avant le match à partir du profil réel de chaque équipe, ces lignes restent identiques pendant toute sa durée (référence stable pour parier), y compris la ligne \"1ère mi-temps\".",
  };
}
