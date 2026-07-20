/**
 * Vérifie les stats détaillées ajoutées aux pronostics (corners, tirs/occasions,
 * cartons) : toujours présentes, cohérentes (total = domicile + extérieur), et
 * clairement annoncées comme une estimation statistique (pas une donnée mesurée,
 * l'API football-data.org en plan gratuit ne fournit pas ces stats).
 */
import { computePronostic } from "../lib/pronostic";

const homeRow = { position: 3, points: 55, form: "WWDLW", playedGames: 20, goalsFor: 40, goalsAgainst: 20, team: { id: 10 } };
const awayRow = { position: 7, points: 44, form: "LWDDW", playedGames: 20, goalsFor: 28, goalsAgainst: 26, team: { id: 11 } };

describe("Pronostics détaillés — corners, tirs, cartons", () => {
  test("computePronostic renvoie des corners/tirs/tirs cadrés cohérents (total = domicile + extérieur), et des cartons jaunes/rouges séparés", () => {
    const result = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    expect(result.extraStats).toBeDefined();
    for (const key of ["corners", "shots", "shotsOnTarget"]) {
      const stat = result.extraStats[key];
      expect(stat.total).toBe(stat.home + stat.away);
      expect(stat.home).toBeGreaterThanOrEqual(0);
      expect(stat.away).toBeGreaterThanOrEqual(0);
    }
    // Les tirs cadrés sont toujours un sous-ensemble des tirs totaux de CE match.
    expect(result.extraStats.shotsOnTarget.total).toBeLessThan(result.extraStats.shots.total);
    expect(result.markets.shotsOnTarget.side).toMatch(/^Plus|Moins$/);
    // Cartons jaunes (majorité, ligne Plus/Moins) et rouges (rares, propre ligne
    // sûre/risquée — voir riskLines) — jamais un total combiné qui masquerait cette
    // distinction.
    const yellow = result.extraStats.cards.yellow;
    expect(yellow.total).toBe(yellow.home + yellow.away);
    expect(yellow.home).toBeGreaterThanOrEqual(0);
    expect(yellow.away).toBeGreaterThanOrEqual(0);
    expect(result.extraStats.raw.redCardExpected).toBeGreaterThanOrEqual(0);
    expect(result.markets.redCards.safe.side).toMatch(/^Plus|Moins$/);
    expect(result.markets.redCards.risky.side).toMatch(/^Plus|Moins$/);

    expect(result.statsNote).toEqual(expect.stringContaining("estimation"));
    expect(result.goals.expectedTotal).toBeCloseTo(result.goals.expectedHome + result.goals.expectedAway, 5);
  });

  // Pronostics figés (correction demandée après coup) : computePronostic ne dépend
  // plus jamais du score ou de la minute en direct (computeLivePronostic a été
  // retiré) — deux appels avec les mêmes équipes doivent donc renvoyer EXACTEMENT le
  // même résultat, quel que soit le moment où on l'appelle pendant le match.
  test("deux appels avec les mêmes équipes renvoient un pronostic strictement identique (rien ne dépend du score/de la minute en direct)", () => {
    const first = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    const second = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    expect(second).toEqual(first);
  });

  test("une équipe nettement plus offensive obtient une part plus élevée de corners et de tirs", () => {
    const strongHome = { position: 1, points: 70, form: "WWWWW", playedGames: 20, goalsFor: 60, goalsAgainst: 15, team: { id: 10 } };
    const weakAway = { position: 18, points: 15, form: "LLLLL", playedGames: 20, goalsFor: 12, goalsAgainst: 50, team: { id: 11 } };
    const result = computePronostic({ homeRow: strongHome, awayRow: weakAway, homeTeamName: "A", awayTeamName: "B" });
    expect(result.extraStats.corners.home).toBeGreaterThan(result.extraStats.corners.away);
    expect(result.extraStats.shots.home).toBeGreaterThan(result.extraStats.shots.away);
    expect(result.extraStats.shotsOnTarget.home).toBeGreaterThan(result.extraStats.shotsOnTarget.away);
  });

  test("deux matchs différents ont des lignes \"Tirs cadrés\" différentes — jamais la même valeur recopiée d'un match à l'autre", () => {
    const matchA = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    const strongHome = { position: 1, points: 70, form: "WWWWW", playedGames: 20, goalsFor: 60, goalsAgainst: 15, team: { id: 12 } };
    const weakAway = { position: 18, points: 15, form: "LLLLL", playedGames: 20, goalsFor: 12, goalsAgainst: 50, team: { id: 13 } };
    const matchB = computePronostic({ homeRow: strongHome, awayRow: weakAway, homeTeamName: "C", awayTeamName: "D" });
    expect(matchA.markets.shotsOnTarget).not.toEqual(matchB.markets.shotsOnTarget);
  });
});
