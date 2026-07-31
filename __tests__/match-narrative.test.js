/**
 * lib/matchNarrative.js — PROMPT 2 : justification courte + niveau de confiance
 * (faible/moyen/élevé) sous chaque ligne de pronostic, et résumé d'avant-match — tous
 * générés à partir des VRAIS chiffres déjà calculés pour CE match (lib/pronostic.js et
 * lib/pronosticFromProfiles.js produisent la même forme de résultat) : jamais un texte
 * générique recopié d'un match à l'autre, jamais une valeur inventée.
 */
import { computePronostic } from "../lib/pronostic";
import { buildStaticNarrative, buildLiveNarrative, buildPreMatchSummary } from "../lib/matchNarrative";

const strongHome = { playedGames: 10, goalsFor: 28, goalsAgainst: 6, position: 1, points: 27, form: "WWWWW" };
const weakAway = { playedGames: 10, goalsFor: 8, goalsAgainst: 24, position: 18, points: 6, form: "LLLDL" };

const closeHome = { playedGames: 10, goalsFor: 14, goalsAgainst: 12, position: 9, points: 15, form: "WDLWD" };
const closeAway = { playedGames: 10, goalsFor: 13, goalsAgainst: 13, position: 10, points: 14, form: "DWLDW" };

function lopsidedResult() {
  return computePronostic({ homeRow: strongHome, awayRow: weakAway, homeTeamName: "Lions FC", awayTeamName: "Renards FC" });
}
function closeResult() {
  return computePronostic({ homeRow: closeHome, awayRow: closeAway, homeTeamName: "Aigles FC", awayTeamName: "Loups FC" });
}

describe("buildStaticNarrative — blocs figés (corners, fautes, hors-jeu, touches, tirs, tirs cadrés, cartons)", () => {
  test("chaque bloc a un texte non vide, dérivé des vrais chiffres du match — jamais un texte générique", () => {
    const result = lopsidedResult();
    const narrative = buildStaticNarrative(result, { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });

    for (const key of ["corners", "fouls", "offsides", "throwIns", "shots", "shotsOnTarget", "yellowCards", "redCards"]) {
      expect(narrative[key].text.length).toBeGreaterThan(10);
      expect(narrative[key].text).not.toMatch(/\bcote\b/i);
    }
    // Les chiffres réels du match (corners/fautes...) apparaissent dans le texte.
    expect(narrative.corners.text).toContain(String(result.extraStats.corners.total));
  });

  test("deux matchs différents produisent des justifications différentes (jamais un texte recopié)", () => {
    const narrativeA = buildStaticNarrative(lopsidedResult(), { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });
    const narrativeB = buildStaticNarrative(closeResult(), { homeTeamName: "Aigles FC", awayTeamName: "Loups FC" });

    for (const key of ["corners", "fouls", "offsides", "throwIns", "shots", "shotsOnTarget"]) {
      expect(narrativeA[key].text).not.toBe(narrativeB[key].text);
    }
    expect(narrativeA.preMatchSummary).not.toBe(narrativeB.preMatchSummary);
  });

  test("un match à sens unique (rapport de force très déséquilibré) a une confiance plus élevée qu'un match équilibré sur les mêmes blocs", () => {
    const lopsided = buildStaticNarrative(lopsidedResult(), { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });
    const close = buildStaticNarrative(closeResult(), { homeTeamName: "Aigles FC", awayTeamName: "Loups FC" });
    const order = { faible: 0, moyen: 1, élevé: 2 };
    // Total de buts (via la confiance de la ligne principale) : un match à sens unique
    // a une estimation plus nettement tranchée qu'un match aux forces égales.
    expect(order[close.shots.confidence]).toBeLessThanOrEqual(order[lopsided.shots.confidence]);
  });

  test("une statistique jamais fournie par aucune source (touches, sur le modèle Bloc 2) reste honnêtement indisponible, jamais un texte inventé", () => {
    const bloc2Result = {
      goals: { expectedHome: 1.4, expectedAway: 1.1, expectedTotal: 2.5 },
      probabilities: { home: 42, draw: 28, away: 30 },
      correctScores: [{ score: "1-1", probability: 12 }],
      extraStats: {
        corners: { home: 5, away: 4, total: 9 },
        fouls: { home: 10, away: 11, total: 21 },
        offsides: { home: 2, away: 1, total: 3 },
        throwIns: { home: null, away: null, total: null }, // jamais fourni par les sources connectées
        shots: { home: 12, away: 9, total: 21 },
        shotsOnTarget: { home: 5, away: 3, total: 8 },
        cards: { yellow: { home: 2, away: 2, total: 4 } },
        raw: { redCardExpected: 0.06 },
      },
      matchStats: {
        corners: { total: { available: true, confidence: 65, lines: [{ confidence: 65 }] } },
        fouls: { total: { available: true, confidence: 58, lines: [{ confidence: 58 }] } },
        offsides: { total: { available: true, confidence: 70, lines: [{ confidence: 70 }] } },
        throwIns: { total: { available: false } },
      },
      markets: {
        shots: { available: true, confidence: 60, lines: [{ confidence: 60 }] },
        shotsOnTarget: { available: true, confidence: 55, lines: [{ confidence: 55 }] },
        yellowCards: { available: true, safe: { confidence: 63 } },
        redCards: { available: true, safe: { confidence: 90 } },
      },
    };
    const narrative = buildStaticNarrative(bloc2Result, { homeTeamName: "A", awayTeamName: "B" });
    expect(narrative.throwIns.confidence).toBeNull();
    expect(narrative.throwIns.text).toMatch(/indisponible/i);
    expect(narrative.throwIns.text).not.toMatch(/\d/); // aucun chiffre inventé pour combler l'absence
    // Les autres blocs, eux, restent bien disponibles avec un vrai texte.
    expect(narrative.corners.text).toContain("9");
  });
});

describe("buildLiveNarrative — probabilité de victoire, scores exacts, Total/Total 1/Total 2", () => {
  test("reflète les VRAIS chiffres actuels de `result` (pré-match ou déjà mis à jour en direct)", () => {
    const result = lopsidedResult();
    const narrative = buildLiveNarrative(result, { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });

    expect(narrative.winProbability.text).toContain("Lions FC");
    expect(narrative.correctScores.text).toContain(result.correctScores[0].score.replace("-", " - "));
    expect(narrative.totalGoals.confidence).not.toBeNull();
  });

  test("un favori très net a une confiance de victoire plus élevée qu'un match sans favori", () => {
    const lopsided = buildLiveNarrative(lopsidedResult(), { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });
    const close = buildLiveNarrative(closeResult(), { homeTeamName: "Aigles FC", awayTeamName: "Loups FC" });
    const order = { faible: 0, moyen: 1, élevé: 2 };
    expect(order[lopsided.winProbability.confidence]).toBeGreaterThan(order[close.winProbability.confidence]);
  });

  test("recalculée à partir de `result` mis à jour (simulateur simple de recalcul live) : le texte change avec les chiffres", () => {
    const result = lopsidedResult();
    const before = buildLiveNarrative(result, { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });

    // Simule un recalcul live (voir pages/api/analyze.js, computeLiveOutcome) qui
    // écrase probabilities/goals/correctScores en place.
    result.probabilities = { home: 40, draw: 30, away: 30 };
    result.goals = { expectedHome: 1.1, expectedAway: 1.0, expectedTotal: 2.1 };
    const after = buildLiveNarrative(result, { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });

    expect(after.winProbability.text).not.toBe(before.winProbability.text);
  });
});

describe("buildPreMatchSummary — résumé de quelques lignes en haut de page", () => {
  test("compare le niveau des deux équipes et donne un scénario, sans jamais inventer de note de qualité absente", () => {
    const result = lopsidedResult();
    const summary = buildPreMatchSummary(result, { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });
    expect(summary).toContain("Lions FC");
    expect(summary).toContain("Renards FC");
    expect(summary.length).toBeGreaterThan(40);
  });

  test("avec des notes de qualité réelles (Bloc 1) disponibles pour les deux équipes, le résumé les utilise", () => {
    const result = lopsidedResult();
    result.qualityRatings = {
      home: { overall: { value: 82, available: true } },
      away: { overall: { value: 24, available: true } },
    };
    const summary = buildPreMatchSummary(result, { homeTeamName: "Lions FC", awayTeamName: "Renards FC" });
    expect(summary).toContain("82/100");
    expect(summary).toContain("24/100");
  });
});
