/**
 * lib/pronosticHistory.js — sauvegarde des pronostics analysés par l'app, vérification
 * automatique à la fin du match (Succès/Échec jugés sur le 1X2 et le Total de buts,
 * contre le VRAI score final), nettoyage des entrées de plus de 5 jours, revérification
 * des matchs encore "pending" à chaque chargement des pages d'historique.
 */
import {
  classifyOutcome, toPredictionSnapshot, saveAndVerifyPrediction, listAndMaintainHistory,
} from "../lib/pronosticHistory";
import { supabase } from "../lib/supabaseClient";
import { getLiveMatch } from "../lib/liveMatchCache";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../lib/liveMatchCache", () => ({ getLiveMatch: jest.fn() }));

// Objet chaînable façon query-builder Supabase : chaque méthode de chaîne (select, eq,
// order, limit, not, is, lt, upsert, update, delete) renvoie le MÊME objet, qui est
// aussi "thenable" (comme le vrai client Supabase, où on peut awaiter à n'importe quel
// maillon de la chaîne) — résout toujours vers `result`. `.maybeSingle()` résout aussi
// vers `result`.
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
  getLiveMatch.mockReset();
});

describe("classifyOutcome — jugé sur le 1X2 et le Total de buts, contre le VRAI score final", () => {
  test("victoire à domicile correctement prédite + Total correct → succès", () => {
    const prediction = {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: { totalGoals: { line: 2.5, side: "Plus" } },
    };
    expect(classifyOutcome(prediction, { home: 2, away: 1 })).toBe("success");
  });

  test("issue 1X2 mal prédite → échec, même si le Total est correct", () => {
    const prediction = {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: { totalGoals: { line: 2.5, side: "Plus" } },
    };
    expect(classifyOutcome(prediction, { home: 0, away: 3 })).toBe("failure");
  });

  test("1X2 correct mais Total de buts faux (\"Plus\" annoncé, total réel en dessous) → échec", () => {
    const prediction = {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: { totalGoals: { line: 2.5, side: "Plus" } },
    };
    expect(classifyOutcome(prediction, { home: 1, away: 0 })).toBe("failure");
  });

  test("match nul correctement prédit comme favori → succès", () => {
    const prediction = {
      probabilities: { home: 30, draw: 40, away: 30 },
      markets: { totalGoals: { line: 2.5, side: "Moins" } },
    };
    expect(classifyOutcome(prediction, { home: 1, away: 1 })).toBe("success");
  });

  test("score final absent ou invalide → null (pas encore vérifiable), jamais une classification inventée", () => {
    const prediction = { probabilities: { home: 60, draw: 25, away: 15 }, markets: {} };
    expect(classifyOutcome(prediction, null)).toBeNull();
    expect(classifyOutcome(prediction, { home: undefined, away: 1 })).toBeNull();
  });

  test("pronostic sans probabilités → null (rien à comparer)", () => {
    expect(classifyOutcome({}, { home: 1, away: 0 })).toBeNull();
  });
});

describe("toPredictionSnapshot — ne garde que les champs de prédiction, jamais l'état live éphémère", () => {
  test("exclut events/matchStatus/matchMinute/matchScore/venue/referee, garde le reste", () => {
    const result = {
      probabilities: { home: 50 }, goals: { expectedTotal: 2.5 }, correctScores: [{ score: "1-0" }],
      extraStats: {}, markets: {}, matchStats: {}, probableScorers: {}, note: "n", statsNote: "s", liveStatNote: "l",
      events: [{ type: "GOAL" }], matchStatus: "IN_PLAY", matchMinute: 30, matchScore: { home: 1, away: 0 },
      venue: "Stade", referee: "Arbitre",
    };
    const snapshot = toPredictionSnapshot(result);
    expect(snapshot).toEqual({
      probabilities: { home: 50 }, goals: { expectedTotal: 2.5 }, correctScores: [{ score: "1-0" }],
      extraStats: {}, markets: {}, matchStats: {}, probableScorers: {}, note: "n", statsNote: "s", liveStatNote: "l",
    });
    expect(snapshot.events).toBeUndefined();
    expect(snapshot.matchStatus).toBeUndefined();
  });

  test("renvoie null pour un résultat absent", () => {
    expect(toPredictionSnapshot(null)).toBeNull();
  });
});

describe("saveAndVerifyPrediction", () => {
  const basePrediction = {
    probabilities: { home: 60, draw: 25, away: 15 },
    markets: { totalGoals: { line: 2.5, side: "Plus" } },
  };

  test("match pas encore terminé : un seul upsert, status \"pending\"", async () => {
    supabase.from = mockSupabaseFrom({ error: null });

    await saveAndVerifyPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: "2026-01-01T00:00:00Z", prediction: basePrediction, matchStatus: "IN_PLAY", finalScore: null,
    });

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("pronostic_history");
  });

  test("match terminé, jamais sauvegardé avant : upsert direct avec le statut déjà classé, puis vérifie qu'aucun \"pending\" ne subsiste", async () => {
    // Le upsert (ignoreDuplicates) insère une ligne déjà classée "success" : le SELECT
    // qui cherche une ligne encore "pending" ne doit donc rien trouver.
    supabase.from = mockSupabaseFrom({ error: null }, { data: null, error: null });

    await saveAndVerifyPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: "2026-01-01T00:00:00Z", prediction: basePrediction, matchStatus: "FINISHED",
      finalScore: { home: 2, away: 0 },
    });

    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  test("match terminé, déjà sauvegardé \"pending\" (upsert n'écrit rien) : relu puis classé Succès/Échec", async () => {
    const updateCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ error: null })) // upsert (no-op, ligne déjà existante)
      .mockReturnValueOnce(chainable({ data: { prediction: basePrediction }, error: null })) // select pending
      .mockImplementationOnce(() => ({ update: updateCall })); // update

    await saveAndVerifyPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: "2026-01-01T00:00:00Z", prediction: basePrediction, matchStatus: "FINISHED",
      finalScore: { home: 2, away: 1 },
    });

    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(updateCall.mock.calls[0][0]).toMatchObject({ status: "success", final_score: { home: 2, away: 1 } });
  });

  test("ignoré pour un match identifié uniquement par API-Football (\"af-...\"), aucun appel Supabase", async () => {
    supabase.from = jest.fn();

    await saveAndVerifyPrediction({
      matchId: "af-999", competitionCode: "PL", homeTeamName: "A", awayTeamName: "B",
      matchDate: "2026-01-01T00:00:00Z", prediction: basePrediction, matchStatus: "FINISHED", finalScore: { home: 1, away: 0 },
    });

    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("erreur Supabase à la sauvegarde : journalisée, ne lève jamais d'exception", async () => {
    supabase.from = mockSupabaseFrom({ error: { message: "boom" } });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(saveAndVerifyPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "A", awayTeamName: "B",
      matchDate: "2026-01-01T00:00:00Z", prediction: basePrediction, matchStatus: "IN_PLAY", finalScore: null,
    })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("nettoyage des entrées de plus de 5 jours — vérifie le VRAI calcul de la date limite", () => {
  test("supprime les entrées vérifiées de plus de 5 jours (verified_at) avec une date limite proche de \"maintenant - 5 jours\"", async () => {
    const ltCalls = [];
    function recordingChainable(result) {
      const obj = {
        select: () => obj, eq: () => obj, order: () => obj, limit: () => obj,
        not: () => obj, is: () => obj,
        lt: (col, value) => { ltCalls.push({ col, value }); return obj; },
        upsert: () => obj, update: () => obj, delete: () => obj,
        maybeSingle: () => Promise.resolve(result),
        then: (resolve) => Promise.resolve(result).then(resolve),
      };
      return obj;
    }
    supabase.from = jest.fn()
      .mockReturnValueOnce(recordingChainable({ error: null })) // cleanup verified_at
      .mockReturnValueOnce(recordingChainable({ error: null })) // cleanup match_date (pending)
      .mockReturnValueOnce(chainable({ data: [], error: null })) // revalidatePending (pas de token -> pas d'appel, mais la requête part quand même)
      .mockReturnValueOnce(chainable({ data: [], error: null })); // liste finale

    const before = Date.now();
    await listAndMaintainHistory("success", null);
    const after = Date.now();

    expect(ltCalls).toHaveLength(2);
    expect(ltCalls[0].col).toBe("verified_at");
    expect(ltCalls[1].col).toBe("match_date");

    const FIVE_DAYS_MS = 5 * 24 * 3600 * 1000;
    for (const call of ltCalls) {
      const cutoffMs = new Date(call.value).getTime();
      // La date limite doit être "maintenant - 5 jours", à quelques secondes près
      // (le temps d'exécution du test) — ni 4 jours, ni 6 jours.
      expect(cutoffMs).toBeGreaterThanOrEqual(before - FIVE_DAYS_MS - 2000);
      expect(cutoffMs).toBeLessThanOrEqual(after - FIVE_DAYS_MS + 2000);
    }
  });
});

describe("listAndMaintainHistory — nettoyage (5 jours) + revérification des \"pending\" + liste triée", () => {
  test("renvoie la liste demandée, du plus récent au plus ancien (déjà trié côté requête)", async () => {
    const rows = [{ match_id: "1", status: "success" }, { match_id: "2", status: "success" }];
    supabase.from = mockSupabaseFrom(
      { error: null }, // cleanup 1 (verified)
      { error: null }, // cleanup 2 (pending)
      { data: [], error: null }, // revalidatePending: aucun "pending" à revérifier
      { data: rows, error: null } // liste finale
    );

    const result = await listAndMaintainHistory("success", "test-token");
    expect(result).toEqual(rows);
  });

  test("un match \"pending\" devenu FINISHED entre-temps est reclassé pendant le chargement de la page", async () => {
    const updateCall = jest.fn(() => chainable({ error: null }));
    const prediction = {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: { totalGoals: { line: 2.5, side: "Plus" } },
    };
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ error: null })) // cleanup 1
      .mockReturnValueOnce(chainable({ error: null })) // cleanup 2
      .mockReturnValueOnce(chainable({ data: [{ match_id: "202", prediction }], error: null })) // pending list
      .mockImplementationOnce(() => ({ update: updateCall })) // update du match désormais terminé
      .mockReturnValueOnce(chainable({ data: [], error: null })); // liste finale demandée

    getLiveMatch.mockResolvedValue({ status: "FINISHED", score: { fullTime: { home: 3, away: 0 } } });

    await listAndMaintainHistory("success", "test-token");

    expect(getLiveMatch).toHaveBeenCalledWith("202", "test-token");
    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(updateCall.mock.calls[0][0]).toMatchObject({ status: "success" });
  });

  test("sans token football-data.org, ne tente aucune revérification (pas d'appel getLiveMatch)", async () => {
    supabase.from = mockSupabaseFrom({ error: null }, { error: null }, { data: [], error: null });

    await listAndMaintainHistory("success", null);
    expect(getLiveMatch).not.toHaveBeenCalled();
  });

  test("erreur Supabase à la lecture finale : renvoie une liste vide, ne plante jamais", async () => {
    supabase.from = mockSupabaseFrom(
      { error: null }, { error: null }, { data: [], error: null },
      { data: null, error: { message: "boom" } }
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await listAndMaintainHistory("failure", "test-token");
    expect(result).toEqual([]);
    errorSpy.mockRestore();
  });
});
