/**
 * lib/pronosticVerification.js — compte-rendu de fin de match LIGNE PAR LIGNE (voir
 * PROMPT "chaque ligne de pronostic doit porter un indicateur visuel") : compare
 * chaque ligne figée (fautes, totaux, corners, cartons, tirs...) au vrai résultat,
 * individuellement — jamais un crochet/une croix inventés quand la donnée réelle
 * n'existe pas (touches : jamais fournies par aucune source ; le reste : best-effort
 * API-Football).
 */
jest.mock("../lib/apiFootball", () => ({
  getFixturesByDate: jest.fn(),
  findLiveFixtureByTeams: jest.fn(),
  getFixtureStatistics: jest.fn(),
  mapFixtureStatistics: jest.fn(),
}));

import { verifyPredictionLines, fetchRealMatchStats } from "../lib/pronosticVerification";
import { getFixturesByDate, findLiveFixtureByTeams, getFixtureStatistics, mapFixtureStatistics } from "../lib/apiFootball";

beforeEach(() => {
  jest.clearAllMocks();
});

function statBlock(total, home, away) {
  return {
    total: { line: total, side: "Plus", lines: [{ line: total, side: "Plus" }] },
    home: { line: home, side: "Plus", lines: [{ line: home, side: "Plus" }] },
    away: { line: away, side: "Plus", lines: [{ line: away, side: "Plus" }] },
    half: { label: "1ère mi-temps", market: { line: total / 2, side: "Plus", lines: [] } },
  };
}

function basePrediction() {
  return {
    markets: {
      totalGoals: { line: 2.5, side: "Plus", lines: [] },
      totalHome: { line: 1.5, side: "Plus", lines: [] },
      totalAway: { line: 0.5, side: "Moins", lines: [] },
      shots: { line: 20.5, side: "Plus", lines: [] },
      yellowCards: { safe: { line: 3.5, side: "Moins" }, risky: { line: 2.5, side: "Moins" } },
      redCards: { safe: { line: 0.5, side: "Moins" }, risky: { line: 0.5, side: "Plus" } },
    },
    matchStats: {
      corners: statBlock(9.5, 5.5, 3.5),
      offsides: statBlock(3.5, 2.5, 1.5),
      fouls: statBlock(21.5, 11.5, 9.5),
      throwIns: statBlock(41.5, 21.5, 19.5),
    },
  };
}

describe("verifyPredictionLines — les lignes de buts (toujours vérifiables via le vrai score final)", () => {
  test("Total/Total 1/Total 2 : ligne atteinte -> true, ligne ratée -> false", () => {
    // 2-1 : total 3 (> 2.5 -> true), domicile 2 (> 1.5 -> true), extérieur 1 (pas < 0.5 -> false)
    const result = verifyPredictionLines({ prediction: basePrediction(), finalScore: { home: 2, away: 1 }, realStats: null });
    expect(result.totalGoals).toBe(true);
    expect(result.totalHome).toBe(true);
    expect(result.totalAway).toBe(false);
  });

  test("score final absent ou invalide -> null pour les lignes de buts, jamais un résultat inventé", () => {
    const result = verifyPredictionLines({ prediction: basePrediction(), finalScore: null, realStats: null });
    expect(result.totalGoals).toBeNull();
    expect(result.totalHome).toBeNull();
    expect(result.totalAway).toBeNull();
  });
});

describe("verifyPredictionLines — corners/hors-jeu/fautes : vérifiées ligne par ligne (total/domicile/extérieur), jamais la mi-temps", () => {
  test("avec de vraies stats API-Football disponibles, chaque sous-ligne est vérifiée individuellement (un match peut avoir des lignes vertes ET rouges)", () => {
    const realStats = {
      corners: { home: 6, away: 2, total: 8 }, // total 8 < 9.5 -> false ; home 6 > 5.5 -> true ; away 2 < 3.5... side "Plus" donc away doit être > 3.5 -> false
      offsides: { home: 4, away: 2, total: 6 }, // total 6 > 3.5 -> true ; home 4 > 2.5 -> true ; away 2 > 1.5 -> true
      fouls: { home: 10, away: 8, total: 18 },
      shots: { home: 12, away: 9, total: 21 },
      yellowCards: { home: 2, away: 1, total: 3 },
      redCards: { home: 0, away: 0, total: 0 },
    };
    const result = verifyPredictionLines({ prediction: basePrediction(), finalScore: { home: 2, away: 1 }, realStats });

    expect(result.corners).toEqual({ total: false, home: true, away: false });
    expect(result.offsides).toEqual({ total: true, home: true, away: true });
  });

  test("sans vraies stats disponibles (realStats null : pas de clé, ou match introuvable côté API-Football), toutes ces lignes deviennent honnêtement 'Indisponible' (null)", () => {
    const result = verifyPredictionLines({ prediction: basePrediction(), finalScore: { home: 2, away: 1 }, realStats: null });
    expect(result.corners).toEqual({ total: null, home: null, away: null });
    expect(result.offsides).toEqual({ total: null, home: null, away: null });
    expect(result.fouls).toEqual({ total: null, home: null, away: null });
    expect(result.shots).toBeNull();
    expect(result.yellowCards).toEqual({ safe: null, risky: null });
    expect(result.redCards).toEqual({ safe: null, risky: null });
  });

  test("les touches (rentrées en jeu) restent TOUJOURS 'Indisponible', même avec de vraies stats pour tout le reste : aucune source ne les fournit", () => {
    const realStats = {
      corners: { home: 6, away: 2, total: 8 }, offsides: { home: 4, away: 2, total: 6 },
      fouls: { home: 10, away: 8, total: 18 }, shots: { home: 12, away: 9, total: 21 },
      yellowCards: { home: 2, away: 1, total: 3 }, redCards: { home: 0, away: 0, total: 0 },
    };
    const result = verifyPredictionLines({ prediction: basePrediction(), finalScore: { home: 2, away: 1 }, realStats });
    expect(result.throwIns).toEqual({ total: null, home: null, away: null });
  });
});

describe("verifyPredictionLines — tirs et cartons (best-effort, API-Football)", () => {
  test("tirs et cartons jaunes/rouges (sûr/risqué) vérifiés individuellement contre le vrai décompte final", () => {
    const realStats = {
      corners: { home: 0, away: 0, total: 0 }, offsides: { home: 0, away: 0, total: 0 }, fouls: { home: 0, away: 0, total: 0 },
      shots: { home: 12, away: 9, total: 21 }, // 21 > 20.5 -> true
      yellowCards: { home: 2, away: 1, total: 3 }, // safe: 3 < 3.5 -> true ; risky: 3 < 2.5 -> false
      redCards: { home: 1, away: 0, total: 1 }, // safe: 1 < 0.5 -> false ; risky: 1 > 0.5 -> true
    };
    const result = verifyPredictionLines({ prediction: basePrediction(), finalScore: { home: 2, away: 1 }, realStats });
    expect(result.shots).toBe(true);
    expect(result.yellowCards).toEqual({ safe: true, risky: false });
    expect(result.redCards).toEqual({ safe: false, risky: true });
  });
});

describe("fetchRealMatchStats — retrouve les vraies stats finales par date + noms d'équipe (le match n'est plus 'en direct')", () => {
  test("sans clé API-Football, renvoie null sans appeler l'API", async () => {
    const result = await fetchRealMatchStats({ homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", matchDate: "2026-01-15T15:00:00Z", apiFootballKey: null });
    expect(result).toBeNull();
    expect(getFixturesByDate).not.toHaveBeenCalled();
  });

  test("interroge getFixturesByDate avec la date du match (YYYY-MM-DD extrait de l'ISO complet)", async () => {
    getFixturesByDate.mockResolvedValue([{ fixture: { id: 555 } }]);
    findLiveFixtureByTeams.mockReturnValue({ fixture: { id: 555 }, teams: { home: { id: 100 } } });
    getFixtureStatistics.mockResolvedValue([{ team: { id: 100 } }, { team: { id: 101 } }]);
    mapFixtureStatistics.mockReturnValue({ corners: { home: 1, away: 2, total: 3 } });

    const result = await fetchRealMatchStats({
      homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", matchDate: "2026-01-15T15:00:00Z", apiFootballKey: "key",
    });

    expect(getFixturesByDate).toHaveBeenCalledWith("2026-01-15", "key");
    expect(findLiveFixtureByTeams).toHaveBeenCalledWith([{ fixture: { id: 555 } }], "Arsenal FC", "Chelsea FC");
    expect(getFixtureStatistics).toHaveBeenCalledWith(555, "key");
    expect(result).toEqual({ corners: { home: 1, away: 2, total: 3 } });
  });

  test("match introuvable côté API-Football pour cette date : renvoie null, jamais des stats inventées", async () => {
    getFixturesByDate.mockResolvedValue([]);
    findLiveFixtureByTeams.mockReturnValue(null);

    const result = await fetchRealMatchStats({
      homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", matchDate: "2026-01-15T15:00:00Z", apiFootballKey: "key",
    });
    expect(result).toBeNull();
    expect(getFixtureStatistics).not.toHaveBeenCalled();
  });

  test("une erreur réseau ne fait jamais planter le compte-rendu : renvoie null", async () => {
    getFixturesByDate.mockRejectedValue(new Error("boom"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await fetchRealMatchStats({
      homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", matchDate: "2026-01-15T15:00:00Z", apiFootballKey: "key",
    });
    expect(result).toBeNull();
    errorSpy.mockRestore();
  });
});
