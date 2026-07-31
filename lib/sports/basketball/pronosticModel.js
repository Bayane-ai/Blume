// Bloc 3 (pronostics basket) — croise les DEUX profils réels d'équipe (voir
// lib/sports/basketball/statProfiles.js) pour produire toutes les lignes de
// pronostic d'un match, même principe que lib/pronosticFromProfiles.js pour le
// football (attaque domicile x défense extérieure pour les points, et
// réciproquement), adapté aux métriques basket.
//
// Modèle de probabilité : le basket se joue sur de grands totaux (~100-120 points)
// — une approximation normale (voir lib/sports/basketball/normalDist.js), centrée
// sur les vraies moyennes/écarts-types de CHAQUE équipe, remplace le modèle de
// Poisson du football (pensé pour un petit nombre de buts). Pour les AUTRES lignes
// (rebonds, passes, 3 points, fautes, lancers francs — des comptages plus petits),
// lib/pronostic.js#overUnderLine/riskLines (modèle de Poisson) reste numériquement
// valable et est réutilisé tel quel, jamais dupliqué.
import { overUnderLine, riskLines, round1 } from "../../pronostic";
import { normalProbabilityOver } from "./normalDist";

// round1 (lib/pronostic.js) convertit une FRACTION (0..1) en pourcentage à 1
// décimale — pas un arrondi générique. Pour les valeurs déjà en points (pas des
// fractions 0..1), on utilise round1Point ci-dessous.
function round1Point(x) {
  return x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
}

function safeValue(field) {
  return field?.available ? field.value : null;
}

function averageAvailable(values) {
  const usable = values.filter((v) => v != null && Number.isFinite(v));
  if (!usable.length) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

// Confronte l'attaque (points marqués) d'une équipe à SON lieu, à la défense
// (points encaissés) de l'adversaire au sien — jamais les statistiques d'une équipe
// mélangées avec celles de l'autre.
function crossExpectation(attackField, defenseField) {
  return averageAvailable([safeValue(attackField), safeValue(defenseField)]);
}

function sumRequired(values) {
  if (values.some((v) => v == null || !Number.isFinite(v))) return null;
  return values.reduce((a, b) => a + b, 0);
}

function lineOrUnavailable(total, opts) {
  if (total == null || !Number.isFinite(total)) return { available: false };
  return { available: true, ...overUnderLine(total, opts) };
}

// Écart-type combiné de deux champs (attaque d'une équipe, défense de l'autre) —
// moyenne des deux écarts-types réels disponibles ; repli sur sqrt(moyenne) (même
// principe que la variance d'une loi de Poisson) uniquement si aucun écart-type réel
// n'a pu être calculé (échantillon insuffisant, voir statProfiles.js).
function crossedStdDev(fieldA, fieldB, fallbackMean) {
  const values = [fieldA?.stdDev, fieldB?.stdDev].filter((v) => v != null && Number.isFinite(v));
  if (values.length) return values.reduce((a, b) => a + b, 0) / values.length;
  return fallbackMean != null ? Math.sqrt(Math.max(1, fallbackMean)) : null;
}

// Bloc 1 — probabilité de victoire (pas de match nul au basket) : approximation
// normale sur l'écart de points attendu, à partir des vraies moyennes/écarts-types
// des deux équipes.
function computeWinProbability(lambdaHome, lambdaAway, sdHome, sdAway) {
  const marginMean = lambdaHome - lambdaAway;
  const sdCombined = Math.sqrt((sdHome || 1) ** 2 + (sdAway || 1) ** 2);
  const pHome = normalProbabilityOver(0, marginMean, sdCombined);
  const homePct = round1(pHome);
  return { home: homePct, away: round1(1 - pHome) };
}

// Bloc 2 — 3 à 4 scores finaux plausibles, dérivés des VRAIS points attendus et de
// la vraie dispersion des deux équipes (jamais un tirage aléatoire) : un score
// central (le plus probable), une variante à rythme plus soutenu, une variante plus
// fermée/défensive, et — seulement quand le match est serré — une variante à écart
// resserré côté favori (pas de 4e variante redondante pour un match déjà très
// déséquilibré).
function buildProbableFinalScores(lambdaHome, lambdaAway, sdHome, sdAway) {
  const spread = Math.max(4, Math.round((sdHome + sdAway) / 2));
  const seen = new Set();
  const scores = [];
  const add = (home, away) => {
    const h = Math.max(0, Math.round(home));
    const a = Math.max(0, Math.round(away));
    const key = `${h}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    scores.push({ home: h, away: a });
  };

  add(lambdaHome, lambdaAway); // scénario central
  add(lambdaHome + spread, lambdaAway + spread * 0.75); // rythme plus soutenu (haut score)
  add(Math.max(lambdaHome * 0.85, lambdaHome - spread), Math.max(lambdaAway * 0.85, lambdaAway - spread)); // match plus fermé
  const margin = Math.abs(lambdaHome - lambdaAway);
  if (margin < spread) {
    // Match serré : une 4e variante où l'écart s'inverse légèrement.
    add(lambdaHome - spread * 0.4, lambdaAway + spread * 0.4);
  } else {
    // Match à sens unique : une 4e variante qui creuse encore l'écart.
    add(lambdaHome + spread * 0.5, lambdaAway - spread * 0.5);
  }
  return scores.slice(0, 4);
}

// Bloc 3 — écart de points (Plus/Moins de X,5), toujours exprimé du point de vue de
// l'équipe favorite (celle dont les points attendus sont les plus élevés) : une
// ligne sûre (écart plus resserré, forte probabilité réelle) et une ligne plus
// risquée (écart plus large) — même mécanique que lib/pronostic.js#riskLines,
// appliquée à l'écart de points plutôt qu'aux corners/cartons.
function buildPointSpread(lambdaHome, lambdaAway) {
  const margin = lambdaHome - lambdaAway;
  const absMargin = Math.abs(margin);
  const favorite = margin >= 0 ? "home" : "away";
  const lines = riskLines(absMargin);
  return { favorite, safe: lines.safe, risky: lines.risky };
}

const DEFAULT_Q1_SHARE = 0.25;
const DEFAULT_FIRST_HALF_SHARE = 0.5;

// Bloc 12 — courte justification (1-2 phrases) pour la probabilité de victoire,
// dérivée des vrais points attendus de CE match (jamais un texte générique recopié).
function winProbabilityReason(probabilities, lambdaHome, lambdaAway, hName, aName) {
  const favoriteIsHome = probabilities.home >= probabilities.away;
  const favorite = favoriteIsHome ? hName : aName;
  const favoritePct = Math.max(probabilities.home, probabilities.away);
  const favoritePoints = favoriteIsHome ? lambdaHome : lambdaAway;
  const opponentPoints = favoriteIsHome ? lambdaAway : lambdaHome;
  return `${favorite} part favori(te) (${favoritePct} %), avec ${round1Point(favoritePoints)} points attendus contre ${round1Point(opponentPoints)} pour l'adversaire, d'après le rythme offensif et défensif réel des deux équipes.`;
}

export function computeBasketballPronostic({ homeProfile, awayProfile, homeTeamName, awayTeamName, liveOffset = null }) {
  if (!homeProfile?.available || !awayProfile?.available) {
    return { available: false, reason: "profil d'équipe indisponible" };
  }
  const hName = homeTeamName || "Domicile";
  const aName = awayTeamName || "Extérieur";
  const home = homeProfile.home;
  const away = awayProfile.away;

  const expectedHome = crossExpectation(home.pointsFor, away.pointsAgainst);
  const expectedAway = crossExpectation(away.pointsFor, home.pointsAgainst);
  if (expectedHome == null || expectedAway == null) {
    return { available: false, reason: "points indisponibles pour au moins une équipe" };
  }
  const lambdaHome = Math.max(1, expectedHome);
  const lambdaAway = Math.max(1, expectedAway);
  const sdHome = crossedStdDev(home.pointsFor, away.pointsAgainst, lambdaHome);
  const sdAway = crossedStdDev(away.pointsFor, home.pointsAgainst, lambdaAway);

  // Bloc "figé/live" (voir PROMPT) : la probabilité de victoire, les scores finaux
  // et les totaux suivent le score RÉEL en cours — `liveOffset` (fourni par
  // pages/api/basketball/analyze.js à partir du score en direct actuel) ajoute les
  // points déjà marqués aux points restant à jouer, jamais l'inverse.
  const offsetHome = liveOffset?.home ?? 0;
  const offsetAway = liveOffset?.away ?? 0;
  const remainingFraction = liveOffset?.remainingFraction ?? 1;
  const remainingHome = lambdaHome * remainingFraction;
  const remainingAway = lambdaAway * remainingFraction;
  const finalHome = offsetHome + remainingHome;
  const finalAway = offsetAway + remainingAway;

  const probabilities = computeWinProbability(remainingHome || 0.01, remainingAway || 0.01, sdHome, sdAway);
  // Une fois le score déjà engagé, l'avantage acquis (offset) pèse aussi dans la
  // probabilité réelle — recalculée sur l'écart total attendu en fin de match, pas
  // seulement sur le temps de jeu restant.
  const liveMarginProbabilities = liveOffset ? computeWinProbability(finalHome, finalAway, sdHome, sdAway) : probabilities;

  const goals = {
    expectedHome: round1Point(finalHome),
    expectedAway: round1Point(finalAway),
    expectedTotal: round1Point(finalHome + finalAway),
  };

  const correctScores = buildProbableFinalScores(finalHome, finalAway, sdHome || 5, sdAway || 5).map((s) => `${s.home}-${s.away}`);

  const markets = {
    totalPoints: overUnderLine(finalHome + finalAway, { withMargin: true }),
    totalHome: overUnderLine(finalHome, { withMargin: true }),
    totalAway: overUnderLine(finalAway, { withMargin: true }),
  };

  const pointSpread = buildPointSpread(finalHome, finalAway);

  // Bloc "Par période" — part RÉELLE du 1er quart-temps/1ère mi-temps de chaque
  // équipe (voir statProfiles.js), jamais une part fixe recopiée quand la donnée
  // réelle est disponible ; repli neutre (25 %/50 %, structurel — un quart-temps est
  // par définition un quart du match) seulement si l'échantillon réel est insuffisant.
  const homeQ1Share = home.q1Share?.available ? home.q1Share.value : DEFAULT_Q1_SHARE;
  const awayQ1Share = away.q1Share?.available ? away.q1Share.value : DEFAULT_Q1_SHARE;
  const homeFirstHalfShare = home.firstHalfShare?.available ? home.firstHalfShare.value : DEFAULT_FIRST_HALF_SHARE;
  const awayFirstHalfShare = away.firstHalfShare?.available ? away.firstHalfShare.value : DEFAULT_FIRST_HALF_SHARE;

  const q1Total = lambdaHome * homeQ1Share + lambdaAway * awayQ1Share;
  const firstHalfTotal = lambdaHome * homeFirstHalfShare + lambdaAway * awayFirstHalfShare;
  const secondHalfTotal = lambdaHome + lambdaAway - firstHalfTotal;

  const periods = {
    quarter1: lineOrUnavailable(q1Total),
    firstHalf: lineOrUnavailable(firstHalfTotal),
    secondHalf: lineOrUnavailable(secondHalfTotal),
  };

  // Blocs 6-9 : rebonds/passes/3 points/fautes — pas de croisement attaque/défense
  // naturel pour ces statistiques (même principe que les tirs/cartons du football,
  // voir lib/pronosticFromProfiles.js) : chaque équipe garde sa propre moyenne réelle.
  function buildOwnStatBlock(key, { withMargin = false } = {}) {
    const homeVal = safeValue(home[key]);
    const awayVal = safeValue(away[key]);
    const total = sumRequired([homeVal, awayVal]);
    return {
      total: lineOrUnavailable(total, { withMargin }),
      home: lineOrUnavailable(homeVal),
      away: lineOrUnavailable(awayVal),
    };
  }

  const rebounds = buildOwnStatBlock("rebounds");
  const assists = buildOwnStatBlock("assists");
  const threePointers = buildOwnStatBlock("threePointersMade");
  const fouls = buildOwnStatBlock("fouls");

  // Blocs 10-11 : ballons perdus et lancers francs — Total match uniquement (voir PROMPT).
  const turnoversTotal = sumRequired([safeValue(home.turnovers), safeValue(away.turnovers)]);
  const freeThrowsTotal = sumRequired([safeValue(home.freeThrowsMade), safeValue(away.freeThrowsMade)]);

  return {
    available: true,
    home: { name: hName, source: "profil d'équipe (basket)" },
    away: { name: aName, source: "profil d'équipe (basket)" },
    probabilities: liveMarginProbabilities,
    goals,
    correctScores,
    pointSpread,
    markets,
    periods,
    rebounds,
    assists,
    threePointers,
    fouls,
    turnovers: { total: lineOrUnavailable(turnoversTotal) },
    freeThrows: { total: lineOrUnavailable(freeThrowsTotal) },
    narrative: {
      winProbability: winProbabilityReason(liveMarginProbabilities, finalHome, finalAway, hName, aName),
    },
    note: "Estimation statistique (approximation normale) basée sur les vrais matchs récents de chaque équipe, domicile/extérieur — pas une IA.",
    statsNote:
      "Rebonds, passes décisives, tirs à 3 points, fautes, ballons perdus et lancers francs sont calculés une seule fois avant le match à partir des vraies statistiques récentes de chaque équipe, et restent figés pendant toute sa durée — référence stable pour parier, validée à la fin du match.",
  };
}
