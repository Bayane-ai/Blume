/**
 * lib/comboHistory.js — BLOC 4.B "Suivi dans le temps" : enregistre chaque combiné
 * "Combiné Vision" généré (pending), le classe Gagné/Perdu une fois TOUS ses matchs
 * terminés ("une seule sélection perdue = combiné perdu", voir PROMPT), calcule le
 * taux de réussite par niveau de risque, nettoie les entrées de plus de 5 jours.
 */
import { saveComboPredictions, getSuccessRates, getComboStatuses, maintainAndGetComboStats } from "../lib/comboHistory";
import { supabase } from "../lib/supabaseClient";
import { getLiveMatch } from "../lib/liveMatchCache";
import { fetchRealMatchStats } from "../lib/pronosticVerification";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../lib/liveMatchCache", () => ({ getLiveMatch: jest.fn() }));
jest.mock("../lib/pronosticVerification", () => ({ fetchRealMatchStats: jest.fn(() => Promise.resolve(null)) }));

function chainable(result) {
  const obj = {
    select: () => obj, eq: () => obj, in: () => obj, order: () => obj, limit: () => obj,
    not: () => obj, is: () => obj, lt: () => obj, upsert: () => obj, update: () => obj, delete: () => obj,
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

beforeEach(() => {
  supabase.from = jest.fn();
  getLiveMatch.mockReset();
  fetchRealMatchStats.mockReset().mockResolvedValue(null);
});

function leg(overrides = {}) {
  return {
    matchId: 1, homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", competitionName: "Premier League",
    marketLabel: "Issue du match", pickLabel: "Victoire Arsenal FC", confidence: 62,
    verify: { type: "winner", key: "home" },
    match: { utcDate: "2026-07-21T15:00:00Z" },
    ...overrides,
  };
}

function combo(overrides = {}) {
  return {
    id: "combo-faible-1-2-prematch", riskLevel: "faible", isLive: false, confidence: 34.1,
    legs: [leg(), leg({ matchId: 2, homeTeamName: "Real Madrid", awayTeamName: "FC Barcelona" })],
    ...overrides,
  };
}

describe("saveComboPredictions — enregistre les combinés fraîchement générés, jamais réécrasés", () => {
  test("upsert avec les bons champs, status \"pending\", onConflict combo_id/ignoreDuplicates", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveComboPredictions([combo()]);

    expect(upsertCall).toHaveBeenCalledTimes(1);
    const rows = upsertCall.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ combo_id: "combo-faible-1-2-prematch", risk_level: "faible", is_live: false, status: "pending" });
    expect(rows[0].legs).toHaveLength(2);
    expect(upsertCall.mock.calls[0][1]).toEqual({ onConflict: "combo_id", ignoreDuplicates: true });
  });

  test("un combiné avec une sélection connue uniquement d'API-Football (\"af-...\") n'est jamais persisté", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveComboPredictions([combo({ legs: [leg({ matchId: "af-500" }), leg({ matchId: 2 })] })]);

    expect(upsertCall).not.toHaveBeenCalled();
  });

  test("liste vide : aucun appel Supabase", async () => {
    const fromSpy = jest.fn();
    supabase.from = fromSpy;
    await saveComboPredictions([]);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  test("erreur Supabase : journalisée, ne lève jamais d'exception", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    supabase.from = jest.fn(() => ({ upsert: () => chainable({ error: { message: "boom" } }) }));
    await expect(saveComboPredictions([combo()])).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("getSuccessRates — taux de réussite par niveau de risque, uniquement sur les combinés déjà classés", () => {
  test("agrège won/total/pct par niveau de risque, ignore les \"pending\"", async () => {
    supabase.from = jest.fn(() => chainable({
      data: [
        { risk_level: "faible", status: "success" },
        { risk_level: "faible", status: "success" },
        { risk_level: "faible", status: "failure" },
        { risk_level: "eleve", status: "failure" },
      ],
      error: null,
    }));

    const stats = await getSuccessRates();
    expect(stats.faible).toEqual({ won: 2, total: 3, pct: 66.7 });
    expect(stats.eleve).toEqual({ won: 0, total: 1, pct: 0 });
    expect(stats.moyen).toBeUndefined();
  });

  test("aucun combiné classé : objet vide, jamais une erreur", async () => {
    supabase.from = jest.fn(() => chainable({ data: [], error: null }));
    expect(await getSuccessRates()).toEqual({});
  });

  test("erreur Supabase : objet vide, journalisée", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    supabase.from = jest.fn(() => chainable({ data: null, error: { message: "boom" } }));
    expect(await getSuccessRates()).toEqual({});
    errorSpy.mockRestore();
  });
});

describe("getComboStatuses — statut des combinés actuellement affichés", () => {
  test("renvoie {comboId: status} pour chaque combiné trouvé", async () => {
    supabase.from = jest.fn(() => chainable({
      data: [{ combo_id: "a", status: "success" }, { combo_id: "b", status: "pending" }],
      error: null,
    }));
    expect(await getComboStatuses(["a", "b"])).toEqual({ a: "success", b: "pending" });
  });

  test("liste vide : aucun appel Supabase, objet vide", async () => {
    const fromSpy = jest.fn();
    supabase.from = fromSpy;
    expect(await getComboStatuses([])).toEqual({});
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe("maintainAndGetComboStats — revérifie les combinés \"pending\" dont tous les matchs sont terminés", () => {
  test("tous les matchs terminés, aucune sélection perdue : classé \"success\"", async () => {
    const row = {
      combo_id: "c1",
      legs: [
        { matchId: 1, verify: { type: "winner", key: "home" } },
        { matchId: 2, verify: { type: "winner", key: "away" } },
      ],
    };
    getLiveMatch.mockImplementation((matchId) => {
      if (matchId === 1) return Promise.resolve({ status: "FINISHED", score: { fullTime: { home: 2, away: 0 } } });
      if (matchId === 2) return Promise.resolve({ status: "FINISHED", score: { fullTime: { home: 0, away: 3 } } });
      return Promise.resolve(null);
    });

    const updateSpy = jest.fn(() => chainable({ error: null }));
    let call = 0;
    supabase.from = jest.fn(() => {
      call += 1;
      if (call <= 2) return chainable({ error: null });
      if (call === 3) return chainable({ data: [row], error: null });
      if (call === 4) return { update: updateSpy };
      return chainable({ data: [], error: null });
    });

    await maintainAndGetComboStats([], "test-token", null);

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
  });

  test("une sélection perdue : classé \"failure\", même si les autres matchs ne sont pas terminés", async () => {
    const row = {
      combo_id: "c2",
      legs: [
        { matchId: 1, verify: { type: "winner", key: "home" } },
      ],
    };
    getLiveMatch.mockResolvedValue({ status: "FINISHED", score: { fullTime: { home: 0, away: 1 } } });

    const updateSpy = jest.fn(() => chainable({ error: null }));
    let call = 0;
    supabase.from = jest.fn(() => {
      call += 1;
      if (call <= 2) return chainable({ error: null });
      if (call === 3) return chainable({ data: [row], error: null });
      if (call === 4) return { update: updateSpy };
      return chainable({ data: [], error: null });
    });

    await maintainAndGetComboStats([], "test-token", null);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "failure" }));
  });

  test("un match pas encore terminé : reste \"pending\", aucune mise à jour", async () => {
    const row = { combo_id: "c3", legs: [{ matchId: 1, verify: { type: "winner", key: "home" } }] };
    getLiveMatch.mockResolvedValue({ status: "IN_PLAY", score: { fullTime: { home: 0, away: 0 } } });

    const updateSpy = jest.fn(() => chainable({ error: null }));
    let call = 0;
    supabase.from = jest.fn(() => {
      call += 1;
      if (call <= 2) return chainable({ error: null });
      if (call === 3) return chainable({ data: [row], error: null });
      return { update: updateSpy };
    });

    await maintainAndGetComboStats([], "test-token", null);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("sans token football-data.org : aucune revérification tentée (pas d'appel getLiveMatch)", async () => {
    let call = 0;
    supabase.from = jest.fn(() => {
      call += 1;
      if (call <= 2) return chainable({ error: null });
      return chainable({ data: [], error: null });
    });
    await maintainAndGetComboStats([], null, null);
    expect(getLiveMatch).not.toHaveBeenCalled();
  });
});
