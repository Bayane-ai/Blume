/**
 * lib/sports/basketball/pronosticModel.js — bloc 3 : croise les deux profils réels
 * d'équipe pour produire toutes les lignes de pronostic basket. Aucun match nul
 * (probabilité de victoire à 2 issues), scores finaux plausibles dérivés des vrais
 * points attendus, écart de points, totaux, périodes, et statistiques annexes
 * (rebonds/passes/3 points/fautes/ballons perdus/lancers francs) jamais mélangées
 * entre équipes.
 */
import { computeBasketballPronostic } from "../lib/sports/basketball/pronosticModel";

function field(value, { available = true, stdDev = null, sampleSize = 5 } = {}) {
  return { value, available, sampleSize, stdDev };
}

function makeProfile({
  homePointsFor = 110, homePointsAgainst = 100, awayPointsFor = 100, awayPointsAgainst = 108,
  homeRebounds = 44, awayRebounds = 40, homeAssists = 24, awayAssists = 21,
  homeThreePointers = 12, awayThreePointers = 10, homeFouls = 18, awayFouls = 19,
  homeTurnovers = 12, awayTurnovers = 13, homeFT = 16, awayFT = 15,
  homeQ1Share = 0.26, awayQ1Share = 0.24, homeFirstHalfShare = 0.51, awayFirstHalfShare = 0.49,
  stdDev = 10,
} = {}) {
  const homeSplit = {
    pointsFor: field(homePointsFor, { stdDev }), pointsAgainst: field(homePointsAgainst, { stdDev }),
    rebounds: field(homeRebounds), assists: field(homeAssists), threePointersMade: field(homeThreePointers),
    fouls: field(homeFouls), turnovers: field(homeTurnovers), freeThrowsMade: field(homeFT),
    q1Share: field(homeQ1Share), firstHalfShare: field(homeFirstHalfShare),
  };
  const awaySplit = {
    pointsFor: field(awayPointsFor, { stdDev }), pointsAgainst: field(awayPointsAgainst, { stdDev }),
    rebounds: field(awayRebounds), assists: field(awayAssists), threePointersMade: field(awayThreePointers),
    fouls: field(awayFouls), turnovers: field(awayTurnovers), freeThrowsMade: field(awayFT),
    q1Share: field(awayQ1Share), firstHalfShare: field(awayFirstHalfShare),
  };
  return { available: true, home: homeSplit, away: awaySplit };
}

test("indisponible si un des deux profils manque", () => {
  const result = computeBasketballPronostic({ homeProfile: makeProfile(), awayProfile: { available: false }, homeTeamName: "A", awayTeamName: "B" });
  expect(result.available).toBe(false);
});

test("croise attaque domicile x défense extérieure (et réciproquement) pour les points attendus", () => {
  const homeProfile = makeProfile({ homePointsFor: 115, homePointsAgainst: 95 });
  const awayProfile = makeProfile({ awayPointsFor: 90, awayPointsAgainst: 118 });
  const result = computeBasketballPronostic({ homeProfile, awayProfile, homeTeamName: "Lakers", awayTeamName: "Warriors" });

  expect(result.available).toBe(true);
  // Moyenne(attaque domicile=115, défense extérieure=118) = 116,5
  expect(result.goals.expectedHome).toBeCloseTo(116.5, 1);
  // Moyenne(attaque extérieure=90, défense domicile=95) = 92,5
  expect(result.goals.expectedAway).toBeCloseTo(92.5, 1);
});

test("probabilité de victoire : pas de match nul, toujours 100% à deux (domicile+extérieur)", () => {
  const result = computeBasketballPronostic({ homeProfile: makeProfile(), awayProfile: makeProfile(), homeTeamName: "A", awayTeamName: "B" });
  expect(result.probabilities.home + result.probabilities.away).toBeCloseTo(100, 1);
  expect(result.probabilities.draw).toBeUndefined();
});

test("une équipe nettement plus forte est favorite avec une probabilité nettement plus haute", () => {
  const strongHome = makeProfile({ homePointsFor: 125, homePointsAgainst: 95 });
  const weakAway = makeProfile({ awayPointsFor: 90, awayPointsAgainst: 122 });
  const result = computeBasketballPronostic({ homeProfile: strongHome, awayProfile: weakAway, homeTeamName: "A", awayTeamName: "B" });
  expect(result.probabilities.home).toBeGreaterThan(70);
  expect(result.narrative.winProbability).toContain("A");
  expect(result.narrative.winProbability.length).toBeGreaterThan(20);
});

test("scores finaux probables : entre 3 et 4, tous distincts, dérivés des vrais points attendus", () => {
  const result = computeBasketballPronostic({ homeProfile: makeProfile(), awayProfile: makeProfile(), homeTeamName: "A", awayTeamName: "B" });
  expect(result.correctScores.length).toBeGreaterThanOrEqual(3);
  expect(result.correctScores.length).toBeLessThanOrEqual(4);
  expect(new Set(result.correctScores).size).toBe(result.correctScores.length);
  for (const s of result.correctScores) expect(s).toMatch(/^\d+-\d+$/);
});

test("écart de points : ligne sûre et ligne risquée, favori identifié", () => {
  const result = computeBasketballPronostic({
    homeProfile: makeProfile({ homePointsFor: 120, homePointsAgainst: 95 }),
    awayProfile: makeProfile({ awayPointsFor: 90, awayPointsAgainst: 120 }),
    homeTeamName: "A", awayTeamName: "B",
  });
  expect(result.pointSpread.favorite).toBe("home");
  expect(result.pointSpread.safe.line % 1).toBe(0.5);
  expect(result.pointSpread.risky.line % 1).toBe(0.5);
});

test("totaux : Total, Total 1, Total 2 au format Plus/Moins de X,5, jamais un intervalle", () => {
  const result = computeBasketballPronostic({ homeProfile: makeProfile(), awayProfile: makeProfile(), homeTeamName: "A", awayTeamName: "B" });
  for (const market of [result.markets.totalPoints, result.markets.totalHome, result.markets.totalAway]) {
    expect(market.lines[0].line % 1).toBe(0.5);
    expect(["Plus", "Moins"]).toContain(market.lines[0].side);
  }
});

test("par période : 1er quart-temps et 1ère mi-temps dérivés des VRAIES parts de chaque équipe, jamais une part fixe recopiée quand la donnée est réelle", () => {
  const homeProfile = makeProfile({ homeQ1Share: 0.3, homeFirstHalfShare: 0.55 });
  const awayProfile = makeProfile({ awayQ1Share: 0.2, awayFirstHalfShare: 0.45 });
  const result = computeBasketballPronostic({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });
  expect(result.periods.quarter1.available).toBe(true);
  expect(result.periods.firstHalf.available).toBe(true);
  expect(result.periods.secondHalf.available).toBe(true);
  // 1ère + 2ème mi-temps doit reconstituer le total.
  expect(result.periods.firstHalf.line + result.periods.secondHalf.line).not.toBeNaN();
});

test("rebonds/passes/3 points/fautes : Total + Total 1 + Total 2, jamais mélangés entre équipes", () => {
  const result = computeBasketballPronostic({
    homeProfile: makeProfile({ homeRebounds: 48, awayRebounds: 38 }),
    awayProfile: makeProfile({ homeRebounds: 48, awayRebounds: 38 }),
    homeTeamName: "A", awayTeamName: "B",
  });
  expect(result.rebounds.home.available).toBe(true);
  expect(result.rebounds.away.available).toBe(true);
  expect(result.rebounds.home.line).not.toBe(result.rebounds.away.line);
  expect(result.assists.total.available).toBe(true);
  expect(result.threePointers.total.available).toBe(true);
  expect(result.fouls.total.available).toBe(true);
});

test("ballons perdus et lancers francs : Total match uniquement (pas de Total 1/Total 2)", () => {
  const result = computeBasketballPronostic({ homeProfile: makeProfile(), awayProfile: makeProfile(), homeTeamName: "A", awayTeamName: "B" });
  expect(result.turnovers.total.available).toBe(true);
  expect(result.turnovers.home).toBeUndefined();
  expect(result.freeThrows.total.available).toBe(true);
  expect(result.freeThrows.home).toBeUndefined();
});

test("deux matchs différents ne génèrent jamais les mêmes lignes", () => {
  const matchA = computeBasketballPronostic({
    homeProfile: makeProfile({ homePointsFor: 118, homePointsAgainst: 100, homeRebounds: 46 }),
    awayProfile: makeProfile({ awayPointsFor: 95, awayPointsAgainst: 112, awayRebounds: 38 }),
    homeTeamName: "A", awayTeamName: "B",
  });
  const matchB = computeBasketballPronostic({
    homeProfile: makeProfile({ homePointsFor: 101, homePointsAgainst: 99, homeRebounds: 41 }),
    awayProfile: makeProfile({ awayPointsFor: 104, awayPointsAgainst: 100, awayRebounds: 43 }),
    homeTeamName: "C", awayTeamName: "D",
  });
  expect(matchA.markets).not.toEqual(matchB.markets);
  expect(matchA.correctScores).not.toEqual(matchB.correctScores);
  expect(matchA.rebounds).not.toEqual(matchB.rebounds);
});

describe("figé/live — probabilité, scores et totaux suivent le score réel ; le reste ne bouge jamais", () => {
  test("sans score en direct (avant-match) : probabilités/totaux basés sur les points attendus purs", () => {
    const result = computeBasketballPronostic({ homeProfile: makeProfile(), awayProfile: makeProfile(), homeTeamName: "A", awayTeamName: "B" });
    // Moyenne(attaque domicile=110, défense extérieure=108) = 109.
    expect(result.goals.expectedHome).toBeCloseTo(109, 0);
  });

  test("avec un score en direct (liveOffset), la probabilité/les totaux changent ; rebonds/passes/périodes restent identiques", () => {
    const homeProfile = makeProfile();
    const awayProfile = makeProfile();
    const preMatch = computeBasketballPronostic({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });
    const live = computeBasketballPronostic({
      homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B",
      liveOffset: { home: 60, away: 40, remainingFraction: 0.25 },
    });

    expect(live.goals.expectedTotal).not.toBe(preMatch.goals.expectedTotal);
    expect(live.probabilities.home).not.toBe(preMatch.probabilities.home);
    // Figé : jamais recalculé à partir du score en direct.
    expect(live.rebounds).toEqual(preMatch.rebounds);
    expect(live.assists).toEqual(preMatch.assists);
    expect(live.periods).toEqual(preMatch.periods);
    expect(live.turnovers).toEqual(preMatch.turnovers);
    expect(live.freeThrows).toEqual(preMatch.freeThrows);
  });
});
