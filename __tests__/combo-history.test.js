/**
 * lib/comboHistory.js — BLOC 4.B / BLOC 5 "Suivi dans le temps" : enregistre chaque
 * combiné "Combiné Vision" généré (pending), le classe Échec DÈS QU'UNE SEULE
 * sélection est perdue — même si d'autres matchs ne sont pas encore joués (voir
 * PROMPT bloc 5) — et Succès seulement une fois TOUS ses matchs terminés ET toutes
 * les sélections gagnées. Calcule le taux de réussite par niveau de risque, la
 * progression détaillée (sélection par sélection) des combinés affichés, nettoie les
 * entrées de plus de 5 jours.
 */
import { saveComboPredictions, getSuccessRates, getComboProgress, maintainAndGetComboStats } from "../lib/comboHistory";
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

describe("getComboProgress — statut ET résultat de chaque sélection des combinés actuellement affichés (BLOC 5)", () => {
  test("un combiné dont un match est déjà terminé et gagné, l'autre encore en direct : \"pending\", sélection gagnée cochée, l'autre en attente", async () => {
    const row = {
      combo_id: "a",
      legs: [
        { matchId: 1, verify: { type: "winner", key: "home" } },
        { matchId: 2, verify: { type: "winner", key: "away" } },
      ],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getLiveMatch.mockImplementation((matchId) => {
      if (matchId === 1) return Promise.resolve({ status: "FINISHED", score: { fullTime: { home: 2, away: 0 } } });
      if (matchId === 2) return Promise.resolve({ status: "IN_PLAY", score: { fullTime: { home: 0, away: 0 } } });
      return Promise.resolve(null);
    });

    const progress = await getComboProgress(["a"], "test-token", null);
    expect(progress.a.status).toBe("pending");
    expect(progress.a.legResults[1]).toBe(true);
    expect(progress.a.legResults[2]).toBeNull();
  });

  test("liste vide, ou sans token football-data.org : aucun appel Supabase, objet vide", async () => {
    const fromSpy = jest.fn();
    supabase.from = fromSpy;
    expect(await getComboProgress([], "test-token", null)).toEqual({});
    expect(await getComboProgress(["a"], null, null)).toEqual({});
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

// BLOC 5 — "Échec immédiat et automatique" : dès qu'une seule sélection échoue —
// même si d'autres matchs ne sont pas encore joués — le combiné bascule
// IMMÉDIATEMENT en échec, sans attendre que les autres matchs se terminent.
describe("BLOC 5 — échec immédiat dès qu'une sélection est perdue, sans attendre les autres matchs", () => {
  test("exemple du PROMPT : 4 matchs (1 en live + 3 à venir) — le match live échoue déjà (\"Moins de 2,5 buts\" dépassé) → \"failure\" immédiat", async () => {
    const row = {
      combo_id: "c-mixte",
      legs: [
        { matchId: 1, verify: { type: "line", statKey: "totalGoals", line: 2.5, side: "Moins" } }, // en direct, déjà échoué
        { matchId: 2, verify: { type: "winner", key: "home" } }, // pas encore commencé
        { matchId: 3, verify: { type: "winner", key: "away" } }, // pas encore commencé
        { matchId: 4, verify: { type: "winner", key: "home" } }, // pas encore commencé
      ],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getLiveMatch.mockImplementation((matchId) => {
      if (matchId === 1) return Promise.resolve({ status: "IN_PLAY", score: { fullTime: { home: 2, away: 1 } } }); // 3 buts déjà marqués > 2,5
      return Promise.resolve({ status: "SCHEDULED", score: { fullTime: { home: null, away: null } } });
    });

    const progress = await getComboProgress(["c-mixte"], "test-token", null);
    expect(progress["c-mixte"].status).toBe("failure");
    expect(progress["c-mixte"].legResults[1]).toBe(false);
    // Les 3 autres matchs, pas encore joués, restent honnêtement indéterminés — mais
    // le combiné est déjà en échec, sans attendre.
    expect(progress["c-mixte"].legResults[2]).toBeNull();
  });

  test("une ligne \"Plus de X,5\" déjà dépassée en direct est, elle, déjà gagnée (pas encore le combiné entier, si d'autres matchs restent)", async () => {
    const row = {
      combo_id: "c-plus",
      legs: [
        { matchId: 1, verify: { type: "line", statKey: "totalGoals", line: 1.5, side: "Plus" } },
        { matchId: 2, verify: { type: "winner", key: "home" } },
      ],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getLiveMatch.mockImplementation((matchId) => {
      if (matchId === 1) return Promise.resolve({ status: "IN_PLAY", score: { fullTime: { home: 2, away: 0 } } }); // déjà > 1,5
      return Promise.resolve({ status: "SCHEDULED", score: { fullTime: { home: null, away: null } } });
    });

    const progress = await getComboProgress(["c-plus"], "test-token", null);
    expect(progress["c-plus"].legResults[1]).toBe(true);
    expect(progress["c-plus"].status).toBe("pending"); // l'autre match n'a pas commencé
  });

  test("l'issue du match (1X2) et les marchés dépendant de statistiques finales (corners...) n'ont aucun verdict anticipé avant la fin réelle du match", async () => {
    const row = {
      combo_id: "c-winner",
      legs: [
        { matchId: 1, verify: { type: "winner", key: "home" } },
        { matchId: 2, verify: { type: "line", statKey: "corners", line: 8.5, side: "Plus" } },
      ],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getLiveMatch.mockImplementation((matchId) => {
      if (matchId === 1) return Promise.resolve({ status: "IN_PLAY", score: { fullTime: { home: 0, away: 3 } } }); // menée large, mais pas fini
      if (matchId === 2) return Promise.resolve({ status: "IN_PLAY", score: { fullTime: { home: 1, away: 1 } } });
      return Promise.resolve(null);
    });

    const progress = await getComboProgress(["c-winner"], "test-token", null);
    expect(progress["c-winner"].legResults[1]).toBeNull();
    expect(progress["c-winner"].legResults[2]).toBeNull();
    expect(progress["c-winner"].status).toBe("pending");
  });

  test("l'échec (\"Moins\" déjà dépassé en direct) fait basculer la revérification en base immédiatement, sans attendre la fin des autres matchs", async () => {
    const row = {
      combo_id: "c-db",
      legs: [
        { matchId: 1, verify: { type: "line", statKey: "totalGoals", line: 2.5, side: "Moins" } },
        { matchId: 2, verify: { type: "winner", key: "home" } },
      ],
    };
    getLiveMatch.mockImplementation((matchId) => {
      if (matchId === 1) return Promise.resolve({ status: "IN_PLAY", score: { fullTime: { home: 2, away: 1 } } });
      return Promise.resolve({ status: "SCHEDULED", score: { fullTime: { home: null, away: null } } });
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
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "failure" }));
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
