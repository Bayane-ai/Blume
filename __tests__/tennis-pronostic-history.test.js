/**
 * lib/sports/tennis/pronosticHistory.js — gel du pronostic tennis (4 lignes, Live
 * Tennis API), vérification automatique en fin de match contre le VRAI score par set
 * (winner, totalGames, totalSets), classement Succès/Échec basé UNIQUEMENT sur la
 * probabilité de victoire, nettoyage des entrées de plus de 5 jours, revérification
 * des "pending". Relit le match via GET /matches/{id}/score (seul moyen disponible
 * sur ce plan, voir lib/sports/tennis/provider.js — pas de recherche par id générique
 * comme l'ancienne intégration API-Sports).
 */
jest.mock("../lib/supabaseAnon", () => ({ supabaseAnon: { from: jest.fn() } }));
jest.mock("../lib/sports/tennis/provider", () => ({
  getMatchScore: jest.fn(),
  getTennisApiKey: jest.fn(() => "test-key"),
}));

import {
  classifyOutcome, toPredictionSnapshot, canPersistMatch,
  getFrozenPrediction, saveFrozenPrediction, verifyFrozenPrediction,
  listAndMaintainHistory, maybeSweepFinishedPredictions, settleFinishedPredictionsNow,
  __resetSweepThrottleForTests,
} from "../lib/sports/tennis/pronosticHistory";
import { supabaseAnon as supabase } from "../lib/supabaseAnon";
import { getMatchScore } from "../lib/sports/tennis/provider";

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
  getMatchScore.mockReset();
});

describe("classifyOutcome — tennis, jamais de match nul", () => {
  test("le joueur favori (domicile) gagne réellement -> succès", () => {
    const prediction = { probabilities: { home: 63, away: 37 } };
    expect(classifyOutcome(prediction, { home: 2, away: 0 })).toBe("success");
  });

  test("le joueur favori ne gagne pas -> échec", () => {
    const prediction = { probabilities: { home: 63, away: 37 } };
    expect(classifyOutcome(prediction, { home: 0, away: 2 })).toBe("failure");
  });

  test("score final absent/égal -> null", () => {
    const prediction = { probabilities: { home: 55, away: 45 } };
    expect(classifyOutcome(prediction, null)).toBeNull();
    expect(classifyOutcome(prediction, { home: 1, away: 1 })).toBeNull();
  });

  test("pronostic sans probabilités -> null", () => {
    expect(classifyOutcome({}, { home: 2, away: 0 })).toBeNull();
  });
});

describe("canPersistMatch — uniquement les ids tennis (tn-...)", () => {
  test("id tn-... -> true", () => expect(canPersistMatch("tn-123")).toBe(true));
  test("id football numérique -> false", () => expect(canPersistMatch("123")).toBe(false));
  test("id bk-... -> false", () => expect(canPersistMatch("bk-123")).toBe(false));
  test("absent -> false", () => expect(canPersistMatch(null)).toBe(false));
});

describe("toPredictionSnapshot — exclut le live éphémère, garde le reste (dont modelState)", () => {
  test("exclut matchStatus/matchScore/matchMinute/matchPeriod/server/live/available/sets", () => {
    const result = {
      home: { name: "A" }, away: { name: "B" }, bestOf: 3,
      probabilities: { home: 60, away: 40 }, currentSetProbabilities: { home: 55, away: 45 },
      gameTotals: { line: 22.5, side: "Plus" }, totalSets: { line: 2.5, side: "Moins" }, note: "n",
      modelState: { p1Hold: 0.6, p2Hold: 0.55, p1PointOnServe: 0.62, p2PointOnServe: 0.58, pSet: 0.6, bestOf: 3 },
      matchStatus: "IN_PLAY", matchScore: { home: 1, away: 0 }, matchMinute: "40-30", matchPeriod: "Set 2",
      server: "home", live: true, available: true, sets: [{ home: 6, away: 4 }],
    };
    const snapshot = toPredictionSnapshot(result);
    expect(snapshot.matchStatus).toBeUndefined();
    expect(snapshot.matchScore).toBeUndefined();
    expect(snapshot.server).toBeUndefined();
    expect(snapshot.live).toBeUndefined();
    expect(snapshot.available).toBeUndefined();
    expect(snapshot.sets).toBeUndefined();
    expect(snapshot.probabilities).toEqual({ home: 60, away: 40 });
    expect(snapshot.modelState).toEqual(result.modelState);
  });

  test("résultat absent -> null", () => expect(toPredictionSnapshot(null)).toBeNull());
});

describe("getFrozenPrediction", () => {
  test("match jamais analysé -> null", async () => {
    supabase.from = mockSupabaseFrom({ data: null, error: null });
    expect(await getFrozenPrediction("tn-1")).toBeNull();
  });

  test("id non-tennis -> aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    expect(await getFrozenPrediction("123")).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("saveFrozenPrediction", () => {
  const basePrediction = {
    probabilities: { home: 63, away: 37 },
    gameTotals: { line: 22.5, side: "Plus" },
    totalSets: { line: 2.5, side: "Moins" },
  };

  test("match pas terminé : un seul upsert, sport='tennis', status pending", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveFrozenPrediction({
      matchId: "tn-1", homeTeamName: "Djokovic", awayTeamName: "Alcaraz",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "IN_PLAY", finalScore: null, finalSets: null,
    });

    expect(upsertCall.mock.calls[0][0]).toMatchObject({ match_id: "tn-1", sport: "tennis", status: "pending", final_score: null });
    expect(upsertCall.mock.calls[0][1]).toEqual({ onConflict: "match_id", ignoreDuplicates: true });
  });

  test("match déjà terminé dès la première analyse : classé directement (favori gagnant -> succès)", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));
    const finalSets = [{ home: 6, away: 4 }, { home: 6, away: 3 }];

    const returned = await saveFrozenPrediction({
      matchId: "tn-1", homeTeamName: "Djokovic", awayTeamName: "Alcaraz",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "FINISHED",
      finalScore: { home: 2, away: 0 }, finalSets,
    });

    expect(upsertCall.mock.calls[0][0].status).toBe("success");
    expect(upsertCall.mock.calls[0][0].prediction.verification.winner).toBe(true);
    expect(returned.status).toBe("success");
  });

  test("noms de joueur manquants -> aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    await saveFrozenPrediction({ matchId: "tn-1", homeTeamName: "", awayTeamName: "Alcaraz", result: basePrediction, matchStatus: "IN_PLAY" });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("id non-tennis -> aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    await saveFrozenPrediction({ matchId: "123", homeTeamName: "A", awayTeamName: "B", result: basePrediction, matchStatus: "FINISHED", finalScore: { home: 2, away: 0 } });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("verifyFrozenPrediction", () => {
  test("aucun \"pending\" trouvé : idempotent, aucune mise à jour", async () => {
    supabase.from = mockSupabaseFrom({ data: null, error: null });
    await verifyFrozenPrediction("tn-1", { home: 2, away: 0 }, []);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  test("match encore pending : classe et renvoie {status, prediction}", async () => {
    const basePrediction = { probabilities: { home: 63, away: 37 } };
    const updateCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ data: { prediction: basePrediction }, error: null }))
      .mockImplementationOnce(() => ({ update: updateCall }));

    const returned = await verifyFrozenPrediction("tn-1", { home: 2, away: 0 }, [{ home: 6, away: 4 }, { home: 6, away: 4 }]);
    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(updateCall.mock.calls[0][0].status).toBe("success");
    expect(returned.status).toBe("success");
  });

  test("id non-tennis -> aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    await verifyFrozenPrediction("123", { home: 1, away: 0 });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("vérification ligne par ligne (totalGames, totalSets — jamais un crochet inventé)", () => {
  test("totalGames et totalSets comparés au vrai résultat", async () => {
    const updateCall = jest.fn(() => chainable({ error: null }));
    const prediction = { probabilities: { home: 63, away: 37 }, gameTotals: { line: 20.5, side: "Plus" }, totalSets: { line: 2.5, side: "Moins" } };
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ data: { prediction }, error: null }))
      .mockImplementationOnce(() => ({ update: updateCall }));

    // Sets réels : 6-4 puis 6-3 -> 19 jeux (< 20.5, "Plus" -> échoué), 2 sets (< 2.5, "Moins" -> réussi).
    await verifyFrozenPrediction("tn-1", { home: 2, away: 0 }, [{ home: 6, away: 4 }, { home: 6, away: 3 }]);
    const verification = updateCall.mock.calls[0][0].prediction.verification;
    expect(verification.totalGames).toBe(false);
    expect(verification.totalSets).toBe(true);
  });
});

describe("maybeSweepFinishedPredictions / settleFinishedPredictionsNow", () => {
  beforeEach(() => __resetSweepThrottleForTests());

  test("settleFinishedPredictionsNow : toujours un vrai balayage, jamais throttlé", async () => {
    supabase.from = mockSupabaseFrom({ data: [], error: null });
    await settleFinishedPredictionsNow("key");
    expect(supabase.from).toHaveBeenCalledWith("pronostic_history");
  });

  test("un match pending devenu FINISHED est reclassé pendant le balayage (id RÉEL relu directement via getMatchScore)", async () => {
    const updateCall = jest.fn(() => chainable({ error: null }));
    const prediction = { probabilities: { home: 63, away: 37 } };
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ data: [{ match_id: "tn-202", prediction, match_date: "2026-01-01T00:00:00Z" }], error: null }))
      .mockImplementationOnce(() => ({ update: updateCall }));
    getMatchScore.mockResolvedValue({ status: "finished", sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }] });

    await settleFinishedPredictionsNow("key");

    expect(getMatchScore).toHaveBeenCalledWith("202", "key");
    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(updateCall.mock.calls[0][0]).toMatchObject({ status: "success", final_score: { home: 2, away: 0 } });
  });

  test("un match pending toujours en cours n'est jamais reclassé", async () => {
    const prediction = { probabilities: { home: 63, away: 37 } };
    supabase.from = mockSupabaseFrom({ data: [{ match_id: "tn-202", prediction, match_date: "2026-01-01T00:00:00Z" }], error: null });
    getMatchScore.mockResolvedValue({ status: "live", sets: [{ p1: 6, p2: 4 }] });

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

describe("listAndMaintainHistory — filtre sport='tennis', jamais mélangé au football/basket", () => {
  test("renvoie la liste demandée, filtrée par sport et statut", async () => {
    const rows = [{ match_id: "tn-1", status: "success" }];
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
