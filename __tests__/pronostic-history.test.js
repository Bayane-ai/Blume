/**
 * lib/pronosticHistory.js — gel du pronostic affiché (calculé une seule fois, relu tel
 * quel ensuite, jamais recalculé en direct — voir pages/api/analyze.js), vérification
 * automatique à la fin du match (Succès/Échec jugés sur le 1X2 et le Total de buts,
 * contre le VRAI score final), nettoyage des entrées de plus de 5 jours, revérification
 * des matchs encore "pending" à chaque chargement des pages d'historique.
 */
import {
  classifyOutcome, toPredictionSnapshot, getFrozenPrediction, saveFrozenPrediction,
  verifyFrozenPrediction, canPersistMatch, listAndMaintainHistory,
} from "../lib/pronosticHistory";
import { supabase } from "../lib/supabaseClient";
import { getLiveMatch } from "../lib/liveMatchCache";
import { fetchRealMatchStats, verifyPredictionLines } from "../lib/pronosticVerification";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../lib/liveMatchCache", () => ({ getLiveMatch: jest.fn() }));
jest.mock("../lib/pronosticVerification", () => ({
  fetchRealMatchStats: jest.fn(() => Promise.resolve(null)),
  verifyPredictionLines: jest.fn(() => ({ totalGoals: null })),
}));

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
  fetchRealMatchStats.mockReset().mockResolvedValue(null);
  verifyPredictionLines.mockReset().mockReturnValue({ totalGoals: null });
});

// Bloc 3 (parcours vidéo) : la probabilité de victoire posée AVANT le match désigne
// une équipe favorite (celle dont la probabilité — domicile/nul/extérieur — est la
// plus haute). Le badge global Succès/Échec ne juge plus QUE cette question ("cette
// équipe a-t-elle gagné ?") — le Total de buts ne compte plus dans ce verdict global
// (il reste vérifié comme n'importe quelle autre ligne individuelle, voir
// lib/pronosticVerification.js, avec son propre crochet/croix sur la carte).
describe("classifyOutcome — jugé UNIQUEMENT sur l'équipe favorite désignée avant le match, contre le VRAI résultat", () => {
  test("l'équipe favorite à domicile gagne réellement → succès", () => {
    const prediction = { probabilities: { home: 60, draw: 25, away: 15 } };
    expect(classifyOutcome(prediction, { home: 2, away: 1 })).toBe("success");
  });

  test("l'équipe favorite ne gagne pas → échec", () => {
    const prediction = { probabilities: { home: 60, draw: 25, away: 15 } };
    expect(classifyOutcome(prediction, { home: 0, away: 3 })).toBe("failure");
  });

  // Changement de règle explicitement demandé : le Total de buts ne fait plus
  // basculer le verdict global — seule l'équipe favorite compte.
  test("l'équipe favorite gagne réellement mais le Total de buts pronostiqué était faux → succès quand même", () => {
    const prediction = {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: { totalGoals: { line: 2.5, side: "Plus" } }, // "Plus de 2,5" annoncé
    };
    // Total réel = 1 (1-0), donc le marché Total est raté — mais l'équipe favorite
    // (domicile) a bien gagné : le badge global reste "Succès".
    expect(classifyOutcome(prediction, { home: 1, away: 0 })).toBe("success");
  });

  test("l'équipe favorite ne gagne pas, même si le Total de buts pronostiqué était juste → échec quand même", () => {
    const prediction = {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: { totalGoals: { line: 2.5, side: "Plus" } },
    };
    // Total réel = 3 (0-3), le marché Total est correct — mais l'équipe favorite
    // (domicile) a perdu : le badge global reste "Échec".
    expect(classifyOutcome(prediction, { home: 0, away: 3 })).toBe("failure");
  });

  test("match nul réellement joué, correctement désigné comme favori (aucune équipe favorite, le nul l'emporte dans le modèle) → succès", () => {
    const prediction = { probabilities: { home: 30, draw: 40, away: 30 } };
    expect(classifyOutcome(prediction, { home: 1, away: 1 })).toBe("success");
  });

  test("score final absent ou invalide → null (pas encore vérifiable), jamais une classification inventée", () => {
    const prediction = { probabilities: { home: 60, draw: 25, away: 15 } };
    expect(classifyOutcome(prediction, null)).toBeNull();
    expect(classifyOutcome(prediction, { home: undefined, away: 1 })).toBeNull();
  });

  test("pronostic sans probabilités → null (rien à comparer)", () => {
    expect(classifyOutcome({}, { home: 1, away: 0 })).toBeNull();
  });
});

describe("canPersistMatch — un match connu uniquement d'API-Football (\"af-...\") n'est jamais persisté", () => {
  test("id numérique/texte normal → true", () => {
    expect(canPersistMatch("101")).toBe(true);
  });

  test("id préfixé \"af-\" → false", () => {
    expect(canPersistMatch("af-900")).toBe(false);
  });

  test("id absent → false", () => {
    expect(canPersistMatch(null)).toBe(false);
    expect(canPersistMatch(undefined)).toBe(false);
  });
});

describe("toPredictionSnapshot — ne garde que les champs de prédiction, jamais l'état live éphémère", () => {
  test("exclut events/matchStatus/matchMinute/matchScore/venue/referee/available/live, garde le reste", () => {
    const result = {
      home: "Arsenal FC", away: "Chelsea FC",
      probabilities: { home: 50 }, goals: { expectedTotal: 2.5 }, correctScores: [{ score: "1-0" }],
      extraStats: {}, markets: {}, matchStats: {}, probableScorers: {}, cardProneness: { home: [], away: [] },
      h2hUsed: 3, note: "n", statsNote: "s", liveStatNote: "l",
      events: [{ type: "GOAL" }], matchStatus: "IN_PLAY", matchMinute: 30, matchScore: { home: 1, away: 0 },
      venue: "Stade", referee: "Arbitre", available: true, live: true,
    };
    const snapshot = toPredictionSnapshot(result);
    expect(snapshot).toEqual({
      home: "Arsenal FC", away: "Chelsea FC",
      probabilities: { home: 50 }, goals: { expectedTotal: 2.5 }, correctScores: [{ score: "1-0" }],
      extraStats: {}, markets: {}, matchStats: {}, probableScorers: {}, cardProneness: { home: [], away: [] },
      h2hUsed: 3, note: "n", statsNote: "s", liveStatNote: "l",
    });
    expect(snapshot.events).toBeUndefined();
    expect(snapshot.matchStatus).toBeUndefined();
    expect(snapshot.matchMinute).toBeUndefined();
    expect(snapshot.matchScore).toBeUndefined();
    expect(snapshot.venue).toBeUndefined();
    expect(snapshot.referee).toBeUndefined();
  });

  test("renvoie null pour un résultat absent", () => {
    expect(toPredictionSnapshot(null)).toBeNull();
  });
});

describe("getFrozenPrediction — relit le pronostic déjà figé pour un match, sans jamais le recalculer", () => {
  test("match jamais analysé : aucune ligne, renvoie null", async () => {
    supabase.from = mockSupabaseFrom({ data: null, error: null });

    const result = await getFrozenPrediction("101");
    expect(result).toBeNull();
    expect(supabase.from).toHaveBeenCalledWith("pronostic_history");
  });

  test("match déjà figé : renvoie la ligne complète (prediction, status, final_score) telle quelle", async () => {
    const row = { prediction: { probabilities: { home: 60 } }, status: "pending", final_score: null };
    supabase.from = mockSupabaseFrom({ data: row, error: null });

    const result = await getFrozenPrediction("101");
    expect(result).toEqual(row);
  });

  test("ignoré pour un match identifié uniquement par API-Football (\"af-...\"), aucun appel Supabase", async () => {
    supabase.from = jest.fn();
    const result = await getFrozenPrediction("af-900");
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("erreur Supabase : journalisée, renvoie null sans lever d'exception", async () => {
    supabase.from = mockSupabaseFrom({ data: null, error: { message: "boom" } });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await getFrozenPrediction("101");
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("saveFrozenPrediction — fige le pronostic la toute première fois, jamais recalculé ensuite", () => {
  const basePrediction = {
    probabilities: { home: 60, draw: 25, away: 15 },
    markets: { totalGoals: { line: 2.5, side: "Plus" } },
  };

  test("match pas encore terminé : un seul upsert, status \"pending\", final_score null", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveFrozenPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "IN_PLAY", finalScore: null,
    });

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("pronostic_history");
    expect(upsertCall.mock.calls[0][0]).toMatchObject({ match_id: "101", status: "pending", final_score: null });
    // Une seule écriture par match, jamais un écrasement d'un pronostic déjà figé.
    expect(upsertCall.mock.calls[0][1]).toEqual({ onConflict: "match_id", ignoreDuplicates: true });
  });

  test("match déjà terminé dès la première analyse (page ouverte après coup) : classé directement, jamais laissé \"pending\" pour rien", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveFrozenPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "FINISHED",
      finalScore: { home: 3, away: 0 },
    });

    expect(upsertCall.mock.calls[0][0]).toMatchObject({ status: "success", final_score: { home: 3, away: 0 } });
  });

  test("ignoré pour un match identifié uniquement par API-Football (\"af-...\"), aucun appel Supabase", async () => {
    supabase.from = jest.fn();

    await saveFrozenPrediction({
      matchId: "af-999", competitionCode: "PL", homeTeamName: "A", awayTeamName: "B",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "FINISHED", finalScore: { home: 1, away: 0 },
    });

    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("noms d'équipes manquants : aucun appel Supabase (rien d'exploitable à figer)", async () => {
    supabase.from = jest.fn();

    await saveFrozenPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "", awayTeamName: "Chelsea FC",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "IN_PLAY", finalScore: null,
    });

    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("erreur Supabase à la sauvegarde : journalisée, ne lève jamais d'exception", async () => {
    supabase.from = mockSupabaseFrom({ error: { message: "boom" } });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(saveFrozenPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "A", awayTeamName: "B",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "IN_PLAY", finalScore: null,
    })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("match déjà terminé dès la première analyse : compare AUSSI chaque ligne individuellement et fusionne le résultat dans le pronostic sauvegardé (PROMPT — indicateur ✓/✗ par ligne)", async () => {
    const realStats = { corners: { home: 6, away: 3, total: 9 } };
    const verification = { totalGoals: true, corners: { total: false, home: true, away: null } };
    fetchRealMatchStats.mockResolvedValue(realStats);
    verifyPredictionLines.mockReturnValue(verification);
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveFrozenPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "FINISHED",
      finalScore: { home: 3, away: 0 }, apiFootballKey: "af-key",
    });

    expect(fetchRealMatchStats).toHaveBeenCalledWith({
      homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", matchDate: "2026-01-01T00:00:00Z", apiFootballKey: "af-key",
    });
    expect(verifyPredictionLines).toHaveBeenCalledWith({ prediction: basePrediction, finalScore: { home: 3, away: 0 }, realStats });
    expect(upsertCall.mock.calls[0][0].prediction).toEqual({ ...basePrediction, verification });
  });

  test("match pas encore terminé : jamais de vérification ligne par ligne (le match n'a pas de résultat réel)", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveFrozenPrediction({
      matchId: "101", competitionCode: "PL", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: "2026-01-01T00:00:00Z", result: basePrediction, matchStatus: "IN_PLAY", finalScore: null,
    });

    expect(fetchRealMatchStats).not.toHaveBeenCalled();
    expect(verifyPredictionLines).not.toHaveBeenCalled();
    expect(upsertCall.mock.calls[0][0].prediction).toEqual(basePrediction);
  });
});

describe("verifyFrozenPrediction — compte-rendu de fin de match : compare le pronostic FIGÉ au vrai résultat", () => {
  const basePrediction = {
    probabilities: { home: 60, draw: 25, away: 15 },
    markets: { totalGoals: { line: 2.5, side: "Plus" } },
  };

  test("match déjà classé (aucun \"pending\" trouvé) : idempotent, aucune mise à jour", async () => {
    supabase.from = mockSupabaseFrom({ data: null, error: null });

    await verifyFrozenPrediction("101", { home: 2, away: 0 });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  test("match encore \"pending\" : relit le pronostic FIGÉ (jamais un nouveau calcul) et le classe Succès/Échec", async () => {
    const updateCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ data: { prediction: basePrediction }, error: null })) // select pending
      .mockImplementationOnce(() => ({ update: updateCall })); // update

    await verifyFrozenPrediction("101", { home: 2, away: 1 });

    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(updateCall.mock.calls[0][0]).toMatchObject({ status: "success", final_score: { home: 2, away: 1 } });
  });

  test("compare AUSSI chaque ligne individuellement (fautes, corners, totaux...) et fusionne le résultat dans le pronostic FIGÉ, avec les vrais noms d'équipe/date de la ligne déjà enregistrée", async () => {
    const realStats = { fouls: { home: 11, away: 9, total: 20 } };
    const verification = { totalGoals: true, fouls: { total: true, home: false, away: true } };
    fetchRealMatchStats.mockResolvedValue(realStats);
    verifyPredictionLines.mockReturnValue(verification);
    const updateCall = jest.fn(() => chainable({ error: null }));
    const pendingRow = { prediction: basePrediction, home_team_name: "Arsenal FC", away_team_name: "Chelsea FC", match_date: "2026-01-01T00:00:00Z" };
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ data: pendingRow, error: null }))
      .mockImplementationOnce(() => ({ update: updateCall }));

    await verifyFrozenPrediction("101", { home: 2, away: 1 }, "af-key");

    expect(fetchRealMatchStats).toHaveBeenCalledWith({
      homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", matchDate: "2026-01-01T00:00:00Z", apiFootballKey: "af-key",
    });
    expect(verifyPredictionLines).toHaveBeenCalledWith({ prediction: basePrediction, finalScore: { home: 2, away: 1 }, realStats });
    expect(updateCall.mock.calls[0][0].prediction).toEqual({ ...basePrediction, verification });
  });

  test("ignoré pour un match identifié uniquement par API-Football (\"af-...\"), aucun appel Supabase", async () => {
    supabase.from = jest.fn();

    await verifyFrozenPrediction("af-999", { home: 1, away: 0 });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("erreur Supabase à la lecture : journalisée, ne lève jamais d'exception, aucune mise à jour", async () => {
    supabase.from = mockSupabaseFrom({ data: null, error: { message: "boom" } });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(verifyFrozenPrediction("101", { home: 2, away: 0 })).resolves.toBeUndefined();
    expect(supabase.from).toHaveBeenCalledTimes(1);
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

  test("un match \"pending\" reclassé pendant le chargement de la page compare AUSSI chaque ligne individuellement, avec les vrais noms d'équipe/date déjà enregistrés et la clé API-Football transmise", async () => {
    const updateCall = jest.fn(() => chainable({ error: null }));
    const prediction = {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: { totalGoals: { line: 2.5, side: "Plus" } },
    };
    const realStats = { shots: { home: 12, away: 9, total: 21 } };
    const verification = { totalGoals: true, shots: true };
    fetchRealMatchStats.mockResolvedValue(realStats);
    verifyPredictionLines.mockReturnValue(verification);
    supabase.from = jest.fn()
      .mockReturnValueOnce(chainable({ error: null })) // cleanup 1
      .mockReturnValueOnce(chainable({ error: null })) // cleanup 2
      .mockReturnValueOnce(chainable({
        data: [{ match_id: "202", prediction, home_team_name: "Real Madrid", away_team_name: "FC Barcelona", match_date: "2026-01-01T00:00:00Z" }],
        error: null,
      })) // pending list
      .mockImplementationOnce(() => ({ update: updateCall }))
      .mockReturnValueOnce(chainable({ data: [], error: null }));

    getLiveMatch.mockResolvedValue({ status: "FINISHED", score: { fullTime: { home: 3, away: 0 } } });

    await listAndMaintainHistory("success", "test-token", "af-key");

    expect(fetchRealMatchStats).toHaveBeenCalledWith({
      homeTeamName: "Real Madrid", awayTeamName: "FC Barcelona", matchDate: "2026-01-01T00:00:00Z", apiFootballKey: "af-key",
    });
    expect(verifyPredictionLines).toHaveBeenCalledWith({ prediction, finalScore: { home: 3, away: 0 }, realStats });
    expect(updateCall.mock.calls[0][0].prediction).toEqual({ ...prediction, verification });
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
