/**
 * Vérifie les stats détaillées ajoutées aux pronostics (corners, tirs/occasions,
 * cartons) : toujours présentes, cohérentes (total = domicile + extérieur), et
 * clairement annoncées comme une estimation statistique (pas une donnée mesurée,
 * l'API football-data.org en plan gratuit ne fournit pas ces stats).
 */
import { computePronostic, computeLivePronostic } from "../lib/pronostic";

const homeRow = { position: 3, points: 55, form: "WWDLW", playedGames: 20, goalsFor: 40, goalsAgainst: 20, team: { id: 10 } };
const awayRow = { position: 7, points: 44, form: "LWDDW", playedGames: 20, goalsFor: 28, goalsAgainst: 26, team: { id: 11 } };

describe("Pronostics détaillés — corners, tirs, cartons", () => {
  test("computePronostic renvoie des corners/tirs cohérents (total = domicile + extérieur), et des cartons jaunes/rouges séparés", () => {
    const result = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    expect(result.extraStats).toBeDefined();
    for (const key of ["corners", "shots"]) {
      const stat = result.extraStats[key];
      expect(stat.total).toBe(stat.home + stat.away);
      expect(stat.home).toBeGreaterThanOrEqual(0);
      expect(stat.away).toBeGreaterThanOrEqual(0);
    }
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

  test("computeLivePronostic renvoie aussi ces stats détaillées", () => {
    const live = computeLivePronostic({
      homeRow, awayRow, homeTeamName: "A", awayTeamName: "B", currentHome: 1, currentAway: 0, minute: 40,
    });
    expect(live.extraStats).toBeDefined();
    expect(live.extraStats.corners.total).toBe(live.extraStats.corners.home + live.extraStats.corners.away);
    expect(live.statsNote).toEqual(expect.stringContaining("estimation"));
    expect(live.goals.expectedTotal).toBeCloseTo(live.goals.expectedHome + live.goals.expectedAway, 5);
  });

  test("une équipe nettement plus offensive obtient une part plus élevée de corners et de tirs", () => {
    const strongHome = { position: 1, points: 70, form: "WWWWW", playedGames: 20, goalsFor: 60, goalsAgainst: 15, team: { id: 10 } };
    const weakAway = { position: 18, points: 15, form: "LLLLL", playedGames: 20, goalsFor: 12, goalsAgainst: 50, team: { id: 11 } };
    const result = computePronostic({ homeRow: strongHome, awayRow: weakAway, homeTeamName: "A", awayTeamName: "B" });
    expect(result.extraStats.corners.home).toBeGreaterThan(result.extraStats.corners.away);
    expect(result.extraStats.shots.home).toBeGreaterThan(result.extraStats.shots.away);
  });
});
