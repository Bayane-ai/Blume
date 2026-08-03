/**
 * lib/comboHistory.js — BLOC 4.B / BLOC 5 "Suivi dans le temps" : enregistre chaque
 * combiné "Combiné Vision" généré (pending), le classe Échec DÈS QU'UNE SEULE
 * sélection est perdue — même si d'autres matchs ne sont pas encore joués (voir
 * PROMPT bloc 5) — et Succès seulement une fois TOUS ses matchs terminés ET toutes
 * les sélections gagnées. Calcule le taux de réussite par niveau de risque, la
 * progression détaillée (sélection par sélection) des combinés affichés, nettoie les
 * entrées de plus de 5 jours. Bloc 9 : un combiné peut mélanger football/basket/
 * tennis, chaque sélection est vérifiée via l'API de SON sport.
 */
import { saveComboPredictions, getSuccessRates, getComboProgress, maintainAndGetComboStats } from "../lib/comboHistory";
import { supabaseAnon as supabase } from "../lib/supabaseAnon";
import { getLiveMatch } from "../lib/liveMatchCache";
import { fetchRealMatchStats } from "../lib/pronosticVerification";
import { getGameById as getBasketballGameById, getGameStatistics as getBasketballGameStatistics } from "../lib/sports/basketball/provider";
import { getMatchScore as getTennisMatchScore } from "../lib/sports/tennis/provider";

jest.mock("../lib/supabaseAnon", () => ({ supabaseAnon: { from: jest.fn() } }));
jest.mock("../lib/liveMatchCache", () => ({ getLiveMatch: jest.fn() }));
jest.mock("../lib/pronosticVerification", () => ({ fetchRealMatchStats: jest.fn(() => Promise.resolve(null)) }));
jest.mock("../lib/sports/basketball/provider", () => ({
  getGameById: jest.fn(), getGameStatistics: jest.fn(() => Promise.resolve([])), getBasketballApiKey: () => "basket-key",
}));
jest.mock("../lib/sports/tennis/provider", () => ({
  getMatchScore: jest.fn(), getTennisApiKey: () => "tennis-key",
}));

function chainable(result) {
  const obj = {
    select: () => obj, eq: () => obj, in: () => obj, order: () => obj, limit: () => obj,
    not: () => obj, is: () => obj, lt: () => obj, upsert: () => obj, update: () => obj, delete: () => obj,
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

function ctx(overrides = {}) {
  return { token: "test-token", apiFootballKey: null, basketballApiKey: null, tennisApiKey: null, ...overrides };
}

beforeEach(() => {
  supabase.from = jest.fn();
  getLiveMatch.mockReset();
  fetchRealMatchStats.mockReset().mockResolvedValue(null);
  getBasketballGameById.mockReset();
  getBasketballGameStatistics.mockReset().mockResolvedValue([]);
  getTennisMatchScore.mockReset();
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
    expect(rows[0].legs[0].sport).toBe("football");
    expect(upsertCall.mock.calls[0][1]).toEqual({ onConflict: "combo_id", ignoreDuplicates: true });
  });

  test("un combiné avec une sélection connue uniquement d'API-Football (\"af-...\") n'est jamais persisté", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveComboPredictions([combo({ legs: [leg({ matchId: "af-500" }), leg({ matchId: 2 })] })]);

    expect(upsertCall).not.toHaveBeenCalled();
  });

  test("un combiné avec une sélection basket (\"bk-...\")/tennis (\"tn-...\") est bien persisté (jamais exclu comme les ids af-)", async () => {
    const upsertCall = jest.fn(() => chainable({ error: null }));
    supabase.from = jest.fn(() => ({ upsert: upsertCall }));

    await saveComboPredictions([combo({ legs: [leg({ matchId: "bk-500", sport: "basketball" }), leg({ matchId: "tn-9", sport: "tennis" })] })]);

    expect(upsertCall).toHaveBeenCalledTimes(1);
    const rows = upsertCall.mock.calls[0][0][0];
    expect(rows.legs.map((l) => l.sport)).toEqual(["basketball", "tennis"]);
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

    const progress = await getComboProgress(["a"], ctx());
    expect(progress.a.status).toBe("pending");
    expect(progress.a.legResults[1]).toBe(true);
    expect(progress.a.legResults[2]).toBeNull();
  });

  test("liste vide, ou sans aucune clé API : aucun appel Supabase, objet vide", async () => {
    const fromSpy = jest.fn();
    supabase.from = fromSpy;
    expect(await getComboProgress([], ctx())).toEqual({});
    expect(await getComboProgress(["a"], ctx({ token: null }))).toEqual({});
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

    const progress = await getComboProgress(["c-mixte"], ctx());
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

    const progress = await getComboProgress(["c-plus"], ctx());
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

    const progress = await getComboProgress(["c-winner"], ctx());
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

    await maintainAndGetComboStats([], ctx());
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

    await maintainAndGetComboStats([], ctx());

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

    await maintainAndGetComboStats([], ctx());
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

    await maintainAndGetComboStats([], ctx());
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("aucune clé API d'aucun sport : aucune revérification tentée (pas d'appel getLiveMatch)", async () => {
    let call = 0;
    supabase.from = jest.fn(() => {
      call += 1;
      if (call <= 2) return chainable({ error: null });
      return chainable({ data: [], error: null });
    });
    await maintainAndGetComboStats([], ctx({ token: null }));
    expect(getLiveMatch).not.toHaveBeenCalled();
  });
});

// BLOC 9 (multi-sport) — un combiné peut mélanger football/basket/tennis, chaque
// sélection est vérifiée via l'API de SON sport, jamais bloquée par une clé
// manquante pour un AUTRE sport du même combiné.
describe("BLOC 9 — sélections basket/tennis vérifiées via leur propre API", () => {
  test("sélection basket (winner) : relit le vrai match via l'id RÉEL (\"bk-\" retiré), classe Succès/Échec", async () => {
    const row = {
      combo_id: "c-basket",
      legs: [{ matchId: "bk-202", sport: "basketball", verify: { type: "winner", key: "home" } }],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getBasketballGameById.mockResolvedValue({
      id: 202, status: { short: "FT" }, teams: { home: { id: 10 }, away: { id: 11 } },
      scores: { home: { total: 100 }, away: { total: 90 } },
    });

    const progress = await getComboProgress(["c-basket"], ctx({ token: null, basketballApiKey: "basket-key" }));
    expect(getBasketballGameById).toHaveBeenCalledWith("202", "basket-key");
    expect(progress["c-basket"].legResults["bk-202"]).toBe(true);
    expect(progress["c-basket"].status).toBe("success");
  });

  test("sélection basket (ligne rebonds) : vraies statistiques finales via getGameStatistics", async () => {
    const row = {
      combo_id: "c-basket-rebounds",
      legs: [{ matchId: "bk-202", sport: "basketball", verify: { type: "line", statKey: "reboundsTotal", line: 80.5, side: "Plus" } }],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getBasketballGameById.mockResolvedValue({
      id: 202, status: { short: "FT" }, teams: { home: { id: 10 }, away: { id: 11 } },
      scores: { home: { total: 100 }, away: { total: 90 } },
    });
    getBasketballGameStatistics.mockResolvedValue([
      { team: { id: 10 }, statistics: [{ type: "Total Rebounds", value: 45 }] },
      { team: { id: 11 }, statistics: [{ type: "Total Rebounds", value: 40 }] },
    ]);

    const progress = await getComboProgress(["c-basket-rebounds"], ctx({ token: null, basketballApiKey: "basket-key" }));
    expect(progress["c-basket-rebounds"].legResults["bk-202"]).toBe(true); // 45+40=85 > 80.5
  });

  test("sélection tennis (winner + total de jeux) : relit le vrai match via l'id RÉEL (\"tn-\" retiré), jeux dérivés des vrais sets", async () => {
    const row = {
      combo_id: "c-tennis",
      legs: [
        { matchId: "tn-9", sport: "tennis", verify: { type: "winner", key: "home" } },
        { matchId: "tn-9", sport: "tennis", verify: { type: "line", statKey: "totalGames", line: 18.5, side: "Plus" } },
      ],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getTennisMatchScore.mockResolvedValue({
      status: "finished", sets: [{ home: 6, away: 4 }, { home: 6, away: 3 }],
    });

    const progress = await getComboProgress(["c-tennis"], ctx({ token: null, tennisApiKey: "tennis-key" }));
    expect(getTennisMatchScore).toHaveBeenCalledWith("9", "tennis-key");
    // Les deux sélections partagent le même matchId : la seconde écrase la première
    // dans `legResults` (même limitation que le reste de ce fichier, qui indexe par
    // matchId) — ici les deux sont vraies, donc la valeur finale reste `true`.
    expect(progress["c-tennis"].legResults["tn-9"]).toBe(true);
    expect(progress["c-tennis"].status).toBe("success");
  });

  test("tennis : jamais de verdict anticipé sur les totaux de jeux (sets gagnés ≠ jeux totaux), contrairement au football/basket", async () => {
    const row = {
      combo_id: "c-tennis-live",
      legs: [{ matchId: "tn-9", sport: "tennis", verify: { type: "line", statKey: "totalGames", line: 5.5, side: "Plus" } }],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getTennisMatchScore.mockResolvedValue({
      status: "live", sets: [{ home: 6, away: 4 }, { home: 4, away: 2 }], // déjà 16 jeux joués, largement > 5.5
    });

    const progress = await getComboProgress(["c-tennis-live"], ctx({ token: null, tennisApiKey: "tennis-key" }));
    expect(progress["c-tennis-live"].legResults["tn-9"]).toBeNull();
    expect(progress["c-tennis-live"].status).toBe("pending");
  });

  test("combiné mixte football + basket : une clé basket manquante laisse la sélection basket \"en attente\", sans jamais bloquer la sélection football", async () => {
    const row = {
      combo_id: "c-mixte-keys",
      legs: [
        { matchId: 1, sport: "football", verify: { type: "winner", key: "home" } },
        { matchId: "bk-202", sport: "basketball", verify: { type: "winner", key: "home" } },
      ],
    };
    supabase.from = jest.fn(() => chainable({ data: [row], error: null }));
    getLiveMatch.mockResolvedValue({ status: "FINISHED", score: { fullTime: { home: 2, away: 0 } } });

    const progress = await getComboProgress(["c-mixte-keys"], ctx({ basketballApiKey: null }));
    expect(getBasketballGameById).not.toHaveBeenCalled();
    expect(progress["c-mixte-keys"].legResults[1]).toBe(true);
    expect(progress["c-mixte-keys"].legResults["bk-202"]).toBeNull();
    expect(progress["c-mixte-keys"].status).toBe("pending");
  });
});
