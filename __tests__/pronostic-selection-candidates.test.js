/**
 * BLOC 2 "Combiné Vision" — computePronostic().selectionCandidates : le pool de
 * sélections "façon paris sportifs" (1X2, totaux de buts, tirs, cartons, corners,
 * hors-jeu, fautes, touches) que lib/combinedVision.js pioche pour assembler des
 * combinés. Chaque sélection porte une confiance RÉELLE (même modèle de Poisson que le
 * reste du pronostic, dérivé des vraies statistiques de chaque équipe) — jamais une
 * valeur inventée, jamais une cote chiffrée.
 */
import { computePronostic } from "../lib/pronostic";

const homeRow = { position: 3, points: 55, form: "WWDLW", playedGames: 20, goalsFor: 40, goalsAgainst: 20, team: { id: 10 } };
const awayRow = { position: 7, points: 44, form: "LWDDW", playedGames: 20, goalsFor: 28, goalsAgainst: 26, team: { id: 11 } };

const EXPECTED_MARKET_LABELS = [
  "Issue du match", "Total", "Total 1", "Total 2", "Cartons jaunes", "Cartons rouges",
  "Tirs", "Tirs cadrés", "Corners", "Hors-jeu", "Fautes", "Touches",
];

describe("selectionCandidates — pool complet de sélections, chacune avec une confiance réelle", () => {
  test("un candidat par marché attendu, avec une confiance numérique plausible (0-100) et un libellé jamais vide", () => {
    const result = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    expect(Array.isArray(result.selectionCandidates)).toBe(true);
    const labels = result.selectionCandidates.map((c) => c.marketLabel);
    expect(labels.sort()).toEqual([...EXPECTED_MARKET_LABELS].sort());

    for (const c of result.selectionCandidates) {
      expect(typeof c.confidence).toBe("number");
      expect(c.confidence).toBeGreaterThan(0);
      expect(c.confidence).toBeLessThanOrEqual(100);
      expect(typeof c.pickLabel).toBe("string");
      expect(c.pickLabel.length).toBeGreaterThan(0);
    }
  });

  test("le candidat \"Issue du match\" correspond bien à l'issue 1X2 la plus probable de ce match", () => {
    const result = computePronostic({ homeRow, awayRow, homeTeamName: "Arsenal", awayTeamName: "Chelsea" });
    const winner = result.selectionCandidates.find((c) => c.marketLabel === "Issue du match");
    const best = Math.max(result.probabilities.home, result.probabilities.draw, result.probabilities.away);
    expect(winner.confidence).toBe(best);
    if (best === result.probabilities.home) expect(winner.pickLabel).toBe("Victoire Arsenal");
    if (best === result.probabilities.away) expect(winner.pickLabel).toBe("Victoire Chelsea");
    if (best === result.probabilities.draw) expect(winner.pickLabel).toBe("Match nul");
  });

  test("les lignes Plus/Moins utilisent une vraie marge statistique (ligne \"sûre\"), pas la ligne la plus proche de l'estimation (quasi pile-ou-face)", () => {
    const result = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    const corners = result.selectionCandidates.find((c) => c.marketLabel === "Corners");
    // La ligne "au plus proche" affichée sur la page du match (matchStats.corners.total)
    // a une confiance volontairement proche de 50 % — la sélection de Combiné Vision
    // doit être structurellement plus sûre que cette ligne de référence.
    expect(corners.confidence).toBeGreaterThan(result.matchStats.corners.total.confidence);
  });

  test("jamais une valeur inventée : deux matchs différents ont des candidats différents", () => {
    const matchA = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    const strongHome = { position: 1, points: 70, form: "WWWWW", playedGames: 20, goalsFor: 60, goalsAgainst: 15, team: { id: 12 } };
    const weakAway = { position: 18, points: 15, form: "LLLLL", playedGames: 20, goalsFor: 12, goalsAgainst: 50, team: { id: 13 } };
    const matchB = computePronostic({ homeRow: strongHome, awayRow: weakAway, homeTeamName: "C", awayTeamName: "D" });
    expect(matchA.selectionCandidates).not.toEqual(matchB.selectionCandidates);
  });

  test("un favori très net obtient une confiance \"Issue du match\" nettement plus élevée qu'un match équilibré", () => {
    const strongHome = { position: 1, points: 70, form: "WWWWW", playedGames: 20, goalsFor: 60, goalsAgainst: 15, team: { id: 12 } };
    const weakAway = { position: 18, points: 15, form: "LLLLL", playedGames: 20, goalsFor: 12, goalsAgainst: 50, team: { id: 13 } };
    const lopsided = computePronostic({ homeRow: strongHome, awayRow: weakAway, homeTeamName: "A", awayTeamName: "B" });
    const even = computePronostic({ homeRow, awayRow: homeRow, homeTeamName: "C", awayTeamName: "D" });
    const lopsidedWinner = lopsided.selectionCandidates.find((c) => c.marketLabel === "Issue du match");
    const evenWinner = even.selectionCandidates.find((c) => c.marketLabel === "Issue du match");
    expect(lopsidedWinner.confidence).toBeGreaterThan(evenWinner.confidence);
  });

  test("jamais de cote chiffrée (aucun champ \"odds\"/\"cote\") dans le pool de sélections", () => {
    const result = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    expect(JSON.stringify(result.selectionCandidates)).not.toMatch(/\bcote\b/i);
    for (const c of result.selectionCandidates) expect(c.odds).toBeUndefined();
  });

  test("deux appels avec les mêmes équipes renvoient un pool de sélections strictement identique (pronostics figés)", () => {
    const first = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    const second = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    expect(second.selectionCandidates).toEqual(first.selectionCandidates);
  });
});
