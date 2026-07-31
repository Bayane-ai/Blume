/**
 * lib/sports/basketball/pronosticHistory.js — bloc 4 : gel du pronostic basket
 * affiché, vérification automatique ligne par ligne à la fin du match contre le VRAI
 * score/les vraies statistiques (jamais un recalcul), nettoyage des entrées de plus
 * de 5 jours, revérification automatique des matchs encore "pending".
 */
jest.mock("../lib/supabaseAnon", () => ({ supabaseAnon: { from: jest.fn() } }));
jest.mock("../lib/sports/basketball/provider", () => ({
  getGameById: jest.fn(),
  getGameStatistics: jest.fn(() => Promise.resolve([])),
  getBasketballApiKey: jest.fn(() => "test-key"),
}));

import {
  classifyOutcome, classifyByMajority, toPredictionSnapshot, canPersistMatch,
  getFrozenPrediction, saveFrozenPrediction, verifyFrozenPrediction,
  listAndMaintainHistory, maybeSweepFinishedPredictions, settleFinishedPredictionsNow,
  __resetSweepThrottleForTests,
} from "../lib/sports/basketball/pronosticHistory";
import { supabaseAnon as supabase } from "../lib/supabaseAnon";
import { getGameById, getGameStatistics } from "../lib/sports/basketball/provider";

function chainable(result) {
  const obj = {
    select: () => obj, eq: () => obj, order: () => obj, limit: () => obj,
    not: () => obj, is: () => obj, lt: () => obj, upsert: () => obj, update: () => obj, delete: () => obj,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

function mockSupabaseFrom(...responses) {
  const from = jest.fn();
  for (const r of responses) from.mockReturnValueOnce(chainable(r));
  return from;
}

beforeEach(() => {
  supabase.from = jest.fn();
  getGameById.mockReset();
  getGameStatistics.mockReset().mockResolvedValue([]);
});

describe("classifyOutcome — basket, jamais de match nul", () => {
  test("l'équipe favorite (domicile) gagne réellement -> succès", () => {
    const prediction = { probabilities: { home: 63, away: 37 } };
    expect(classifyOutcome(prediction, { home: 108, away: 101 })).toBe("success");
  });

  test("l'équipe favorite ne gagne pas -> échec", () => {
    const prediction = { probabilities: { home: 63, away: 37 } };
    expect(classifyOutcome(prediction, { home: 95, away: 110 })).toBe("failure");
  });

  test("score final absent/égal (jamais un nul réel au basket) -> null", () => {
    const prediction = { probabilities: { home: 55, away: 45 } };
    expect(classifyOutcome(prediction, null)).toBeNull();
    expect(classifyOutcome(prediction, { home: 100, away: 100 })).toBeNull();
  });

  test("pronostic sans probabilités -> null", () => {
    expect(classifyOutcome({}, { home: 100, away: 90 })).toBeNull();
  });
});

describe("classifyByMajority — majorité des lignes réellement vérifiables", () => {
  test("plus de lignes validées que ratées -> success", () => {
    expect(classifyByMajority({ winner: true, totalPoints: true, totalHome: false })).toBe("success");
  });

  test("égalité stricte -> failure (jamais une majorité)", () => {
    expect(classifyByMajority({ winner: true, totalPoints: false })).toBe("failure");
  });

  test("descend dans rebonds/passes/3 points/fautes et l'écart de points", () => {
    const verification = {
      rebounds: { total: true, home: true, away: false },
      pointSpread: { safe: true, risky: false },
    };
    // 3 succès (rebonds total/home, écart safe) vs 2 échecs (rebonds away, écart risky) -> success
    expect(classifyByMajority(verification)).toBe("success");
  });

  test("aucune ligne vérifiable -> null", () => {
    expect(classifyByMajority({ totalPoints: null })).toBeNull();
    expect(classifyByMajority(null)).toBeNull();
  });
});

describe("canPersistMatch — uniquement les ids basket (bk-...)", () => {
  test("id bk-... -> true", () => expect(canPersistMatch("bk-123")).toBe(true));
  test("id football numérique -> false", () => expect(canPersistMatch("123")).toBe(false));
  test("id af-... -> false", () => expect(canPersistMatch("af-123")).toBe(false));
  test("absent -> false", () => expect(canPersistMatch(null)).toBe(false));
});

describe("toPredictionSnapshot — exclut le live éphémère, garde le reste", () => {
  test("exclut matchStatus/matchScore/live/available", () => {
    const result = {
      home: { name: "A" }, away: { name: "B" }, probabilities: { home: 60, away: 40 },
      goals: {}, correctScores: ["108-101"], pointSpread: {}, markets: {}, periods: {},
      rebounds: {}, assists: {}, threePointers: {}, fouls: {}, turnovers: {}, freeThrows: {},
      players: {}, narrative: {}, note: "n", statsNote: "s",
      matchStatus: "IN_PLAY", matchScore: { home: 10, away: 8 }, live: true, available: true,
    };
    const snapshot = toPredictionSnapshot(result);
    expect(snapshot.matchStatus).toBeUndefined();
    expect(snapshot.matchScore).toBeUndefined();
    expect(snapshot.live).toBeUndefined();
    expect(snapshot.available).toBeUndefined();
    expect(snapshot.probabilities).toEqual({ home: 60, away: 40 });
    expect(snapshot.correctScores).toEqual(["108-101"]);
  });

  test("résultat absent -> null", () => expect(toPredictionSnapshot(null)).toBeNull());
});

describe("getFrozenPrediction", () => {
  test("match jamais analysé -> null", async () => {
    supabase.from = mockSupabaseFrom({ data: null, error: null });
    expect(await getFrozenPrediction("bk-1")).toBeNull();
  });

  test("id non-basket -> aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    expect(await getFrozenPrediction("123")).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("saveFrozenPrediction", () => {
  const basePrediction = {
    probabilities: { home: 63, away: 37 },
    markets: { totalPoints: { available: true, line: 220.5, side: "Plus" } },
    correctScores: ["114-107"],
  };

  test("match pas terminé : un seul upsert, sport='basketball', status pending", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveFrozenPrediction({
      matchId: "bk-1", homeTeamName: "Lakers", awayTeamName: "Warriors",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "IN_PLAY", finalScore: null,
    });

    expect(upsertCall.mock.calls[0][0]).toMatchObject({ match_id: "bk-1", sport: "basketball", status: "pending", final_score: null });
    expect(upsertCall.mock.calls[0][1]).toEqual({ onConflict: "match_id", ignoreDuplicates: true });
  });

  test("match déjà terminé dès la première analyse : classé directement (favori gagnant -> succès)", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));
    const game = { id: 1, teams: { home: { id: 10 }, away: { id: 11 } }, scores: { home: { total: 114, quarter_1: 30, quarter_2: 28 }, away: { total: 107, quarter_1: 25, quarter_2: 26 } } };

    const returned = await saveFrozenPrediction({
      matchId: "bk-1", homeTeamName: "Lakers", awayTeamName: "Warriors",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "FINISHED",
      finalScore: { home: 114, away: 107 }, game, apiKey: "key",
    });

    expect(upsertCall.mock.calls[0][0].status).toBe("success");
    expect(upsertCall.mock.calls[0][0].prediction.verification.winner).toBe(true);
    // Score exact prédit (114-107) atteint EXACTEMENT -> validé.
    expect(upsertCall.mock.calls[0][0].prediction.verification.correctScores).toBe(true);
    expect(returned.status).toBe("success");
  });

  test("noms d'équipe manquants -> aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    await saveFrozenPrediction({ matchId: "bk-1", homeTeamName: "", awayTeamName: "Warriors", result: basePrediction, matchStatus: "IN_PLAY" });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("id non-basket -> aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    await saveFrozenPrediction({ matchId: "123", homeTeamName: "A", awayTeamName: "B", result: basePrediction, matchStatus: "FINISHED", finalScore: { home: 1, away: 0 } });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("verifyFrozenPrediction", () => {
  const basePrediction = { probabilities: { home: 63, away: 37 }, markets: {} };

  test("aucun \"pending\" trouvé : idempotent, aucune mise à jour", async () => {
    supabase.from = mockSupabaseFrom({ data: null, error: null });
    await verifyFrozenPrediction("bk-1", { home: 100, away: 90 }, null, "key");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  test("match encore pending : classe et renvoie {status, prediction}", async () => {
    const updateCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ data: { prediction: basePrediction }, error: null }))
      .mockImplementationOnce(() => ({ update: updateCall }));

    const returned = await verifyFrozenPrediction("bk-1", { home: 100, away: 90 }, {}, "key");
    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(updateCall.mock.calls[0][0].status).toBe("success");
    expect(returned.status).toBe("success");
  });

  test("id non-basket -> aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    await verifyFrozenPrediction("123", { home: 1, away: 0 });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("maybeSweepFinishedPredictions / settleFinishedPredictionsNow", () => {
  beforeEach(() => __resetSweepThrottleForTests());

  test("settleFinishedPredictionsNow : toujours un vrai balayage, jamais throttlé", async () => {
    supabase.from = mockSupabaseFrom({ data: [], error: null });
    await settleFinishedPredictionsNow("key");
    expect(supabase.from).toHaveBeenCalledWith("pronostic_history");
  });

  test("un match pending devenu FINISHED est reclassé pendant le balayage (id RÉEL relu directement)", async () => {
    const updateCall = jest.fn(() => chainable({ error: null }));
    const prediction = { probabilities: { home: 63, away: 37 }, markets: {} };
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ data: [{ match_id: "bk-202", prediction, match_date: "2026-01-01T00:00:00Z" }], error: null }))
      .mockImplementationOnce(() => ({ update: updateCall }));
    getGameById.mockResolvedValue({
      id: 202, status: { short: "FT" }, teams: { home: { id: 10 }, away: { id: 11 } },
      scores: { home: { total: 100, quarter_1: 25, quarter_2: 25 }, away: { total: 95, quarter_1: 24, quarter_2: 23 } },
    });

    await settleFinishedPredictionsNow("key");

    expect(getGameById).toHaveBeenCalledWith("202", "key");
    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(updateCall.mock.calls[0][0]).toMatchObject({ status: "success", final_score: { home: 100, away: 95 } });
  });

  test("un match pending toujours en cours n'est jamais reclassé", async () => {
    const prediction = { probabilities: { home: 63, away: 37 }, markets: {} };
    supabase.from = mockSupabaseFrom({ data: [{ match_id: "bk-202", prediction, match_date: "2026-01-01T00:00:00Z" }], error: null });
    getGameById.mockResolvedValue({ id: 202, status: { short: "Q3" }, scores: { home: { total: 60 }, away: { total: 55 } } });

    await settleFinishedPredictionsNow("key");
    expect(supabase.from).toHaveBeenCalledTimes(1); // seulement la lecture, jamais de update
  });

  test("sans clé API, ne fait jamais rien", async () => {
    supabase.from = jest.fn();
    maybeSweepFinishedPredictions(null);
    await new Promise((r) => setImmediate(r));
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("deuxième appel immédiat (fenêtre de 5 min) ne redéclenche aucun balayage", async () => {
    supabase.from = mockSupabaseFrom({ data: [], error: null }, { data: [], error: null });
    maybeSweepFinishedPredictions("key");
    await new Promise((r) => setImmediate(r));
    const callsAfterFirst = supabase.from.mock.calls.length;
    maybeSweepFinishedPredictions("key");
    await new Promise((r) => setImmediate(r));
    expect(supabase.from.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("listAndMaintainHistory — filtre sport='basketball', jamais mélangé au football", () => {
  test("renvoie la liste demandée, filtrée par sport et statut", async () => {
    const rows = [{ match_id: "bk-1", status: "success" }];
    supabase.from = mockSupabaseFrom(
      { error: null }, { error: null }, // cleanup x2
      { data: [], error: null }, // sweep pending
      { data: rows, error: null } // liste finale
    );
    const result = await listAndMaintainHistory("success", "key");
    expect(result).toEqual(rows);
  });

  test("erreur Supabase à la lecture finale -> liste vide, jamais un plantage", async () => {
    supabase.from = mockSupabaseFrom(
      { error: null }, { error: null }, { data: [], error: null },
      { data: null, error: { message: "boom" } }
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await listAndMaintainHistory("failure", "key");
    expect(result).toEqual([]);
    errorSpy.mockRestore();
  });
});
