/**
 * pages/api/basketball/analyze.js — bloc 3/4 : orchestre profils réels + statistiques
 * de joueurs pour produire le pronostic basket complet, le fige (lib/sports/
 * basketball/pronosticHistory.js — mocké ici, testé séparément dans
 * __tests__/basketball-pronostic-history.test.js), recalcule EN DIRECT uniquement
 * probabilité/scores finaux/totaux, et alimente la timeline "Moments forts" (lib/
 * sports/basketball/timeline.js, réelle ici — fonction pure, pas d'appel réseau).
 */
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function field(value, extra = {}) {
  return { value, available: value != null, sampleSize: 5, ...extra };
}

function fullProfile(overrides = {}) {
  const base = {
    pointsFor: field(110, { stdDev: 8 }), pointsAgainst: field(105, { stdDev: 8 }),
    rebounds: field(43), assists: field(23), threePointersMade: field(11),
    fouls: field(18), turnovers: field(12), freeThrowsMade: field(16),
    q1Share: field(0.26), firstHalfShare: field(0.51),
  };
  return { available: true, teamId: 1, teamName: "X", matchesUsed: 8, home: base, away: base, ...overrides };
}

function game({ short = "NS", timer = null, homeTotal = 0, awayTotal = 0, q = {} } = {}) {
  return {
    id: 1, date: "2026-01-01T20:00:00Z", status: { short, timer }, league: { season: "2025-2026" },
    scores: {
      home: { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, total: homeTotal, ...q.home },
      away: { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, total: awayTotal, ...q.away },
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  global.fetch = jest.fn(() => Promise.reject(new Error("Aucun appel réseau attendu (sources mockées)")));
});

test("sans clé API basket configurée : erreur explicite, aucun calcul", async () => {
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => null, getGameById: jest.fn(), getTeamPlayerStatistics: jest.fn(),
  }));
  const { default: handler } = await import("../pages/api/basketball/analyze.js");
  const res = mockRes();
  await handler({ query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.body.available).toBe(false);
});

test("identifiants d'équipe manquants : 400 explicite", async () => {
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "key", getGameById: jest.fn(() => Promise.resolve(null)), getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { default: handler } = await import("../pages/api/basketball/analyze.js");
  const res = mockRes();
  await handler({ query: { matchId: "bk-1", season: "2025-2026" } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});

describe("pronostic pas encore figé (première analyse)", () => {
  function mockModules({ profileOverrides = {}, gameObj = game(), saveReturns = undefined } = {}) {
    jest.doMock("../lib/sports/basketball/provider", () => ({
      getBasketballApiKey: () => "key",
      getGameById: jest.fn(() => Promise.resolve(gameObj)),
      getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock("../lib/sports/basketball/statProfiles", () => ({
      getOrRefreshTeamProfile: jest.fn(({ teamId }) =>
        Promise.resolve(String(teamId) === "10" && profileOverrides.homeUnavailable
          ? { available: false, reason: "aucun match récent" }
          : fullProfile())
      ),
    }));
    const saveFrozenPrediction = jest.fn(() => Promise.resolve(saveReturns));
    const getFrozenPrediction = jest.fn(() => Promise.resolve(null));
    const verifyFrozenPrediction = jest.fn(() => Promise.resolve(undefined));
    jest.doMock("../lib/sports/basketball/pronosticHistory", () => ({
      getFrozenPrediction, saveFrozenPrediction, verifyFrozenPrediction,
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("bk-"),
    }));
    return { saveFrozenPrediction, getFrozenPrediction, verifyFrozenPrediction };
  }

  test("profil d'équipe indisponible : réponse honnête, jamais un pronostic inventé, jamais figé", async () => {
    const { saveFrozenPrediction } = mockModules({ profileOverrides: { homeUnavailable: true } });
    const { default: handler } = await import("../pages/api/basketball/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", season: "2025-2026" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.available).toBe(false);
    expect(saveFrozenPrediction).not.toHaveBeenCalled();
  });

  test("match pas encore commencé : pronostic complet figé (saveFrozenPrediction appelé, status SCHEDULED), 1ère mi-temps affichée, timeline jamais vide", async () => {
    const { saveFrozenPrediction } = mockModules({ gameObj: game({ short: "NS" }) });
    const { default: handler } = await import("../pages/api/basketball/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "A", awayTeamName: "B", season: "2025-2026" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.available).toBe(true);
    expect(res.body.live).toBe(false);
    expect(res.body.matchStatus).toBe("SCHEDULED");
    expect(res.body.periods.activeHalfLabel).toBe("Total 1ère mi-temps");
    expect(res.body.players).toBeDefined();
    expect(res.body.sdHome).toBeGreaterThan(0);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(typeof res.body.timelineNote).toBe("string");
    expect(saveFrozenPrediction).toHaveBeenCalledTimes(1);
    expect(saveFrozenPrediction.mock.calls[0][0]).toMatchObject({ matchId: "bk-1", matchStatus: "SCHEDULED" });
  });

  test("match en direct au 3ème quart-temps : recalcul en direct (probabilité/scores/totaux), 2ème mi-temps affichée", async () => {
    mockModules({
      gameObj: game({ short: "Q3", timer: "5:00", homeTotal: 54, awayTotal: 49, q: { home: { quarter_1: 28, quarter_2: 26 }, away: { quarter_1: 24, quarter_2: 25 } } }),
    });
    const { default: handler } = await import("../pages/api/basketball/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "A", awayTeamName: "B", season: "2025-2026" } },
      res
    );
    expect(res.body.live).toBe(true);
    expect(res.body.matchStatus).toBe("IN_PLAY");
    expect(res.body.matchScore).toEqual({ home: 54, away: 49 });
    expect(res.body.periods.activeHalfLabel).toBe("Total 2ème mi-temps");
    // Le score déjà acquis (54+49) doit peser dans le total attendu.
    expect(res.body.goals.expectedTotal).toBeGreaterThan(54 + 49);
    // Écart de points (figé, bloc 4) : jamais affecté par le score en direct — dérivé
    // uniquement des points attendus PURS (mêmes profils des deux côtés -> match nul
    // "attendu", écart nul).
    expect(res.body.pointSpread).toBeDefined();
  });

  test("match déjà terminé dès la première analyse : classé immédiatement (saveFrozenPrediction renvoie historyStatus)", async () => {
    mockModules({
      gameObj: game({ short: "FT", homeTotal: 110, awayTotal: 100 }),
      saveReturns: { status: "success", prediction: { verification: { winner: true } } },
    });
    const { default: handler } = await import("../pages/api/basketball/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "A", awayTeamName: "B", season: "2025-2026" } },
      res
    );
    expect(res.body.historyStatus).toBe("success");
    expect(res.body.verification).toEqual({ winner: true });
  });

  test("saison introuvable (ni URL ni match) : réponse honnête plutôt qu'un calcul faux", async () => {
    mockModules({ gameObj: null });
    const { default: handler } = await import("../pages/api/basketball/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.available).toBe(false);
  });
});

describe("pronostic déjà figé (relecture, jamais un nouveau calcul de profil)", () => {
  function frozenPrediction() {
    return {
      home: { name: "A" }, away: { name: "B" },
      probabilities: { home: 60, away: 40 },
      goals: { expectedHome: 108, expectedAway: 100, expectedTotal: 208 },
      correctScores: ["108-100"],
      pointSpread: { favorite: "home", safe: { line: 4.5, side: "Moins", confidence: 60 }, risky: { line: 10.5, side: "Plus", confidence: 40 } },
      markets: { totalPoints: { available: true, line: 207.5, side: "Plus", confidence: 55, lines: [{ line: 207.5, side: "Plus", confidence: 55 }] }, totalHome: {}, totalAway: {} },
      periods: {
        quarter1: { available: true, line: 52.5, side: "Plus", confidence: 55, lines: [{ line: 52.5, side: "Plus", confidence: 55 }] },
        firstHalf: { available: true, line: 104.5, side: "Plus", confidence: 55, lines: [{ line: 104.5, side: "Plus", confidence: 55 }] },
        secondHalf: { available: true, line: 103.5, side: "Moins", confidence: 55, lines: [{ line: 103.5, side: "Moins", confidence: 55 }] },
      },
      rebounds: {}, assists: {}, threePointers: {}, fouls: {},
      turnovers: { total: {} }, freeThrows: { total: {} },
      players: { home: {}, away: {} },
      narrative: { winProbability: "A part favori..." },
      note: "n", statsNote: "s", sdHome: 8, sdAway: 8,
    };
  }

  test("profils JAMAIS refetchés quand un pronostic figé existe déjà", async () => {
    const getOrRefreshTeamProfile = jest.fn();
    jest.doMock("../lib/sports/basketball/provider", () => ({
      getBasketballApiKey: () => "key",
      getGameById: jest.fn(() => Promise.resolve(game({ short: "Q1", homeTotal: 10, awayTotal: 8 }))),
      getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock("../lib/sports/basketball/statProfiles", () => ({ getOrRefreshTeamProfile }));
    jest.doMock("../lib/sports/basketball/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve({ prediction: frozenPrediction(), status: "pending" })),
      saveFrozenPrediction: jest.fn(),
      verifyFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("bk-"),
    }));
    const { default: handler } = await import("../pages/api/basketball/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "A", awayTeamName: "B", season: "2025-2026" } }, res);

    expect(getOrRefreshTeamProfile).not.toHaveBeenCalled();
    expect(res.body.available).toBe(true);
    // Le recalcul en direct utilise les lambdas FIGÉS (goals.expectedHome=108, pas un
    // nouveau calcul) -> le total attendu doit intégrer le score déjà acquis (10+8).
    expect(res.body.live).toBe(true);
    expect(res.body.goals.expectedTotal).toBeGreaterThan(10 + 8);
  });

  test("match FINISHED, pronostic déjà classé (historyStatus déjà présent) : verifyFrozenPrediction jamais rappelé", async () => {
    jest.doMock("../lib/sports/basketball/provider", () => ({
      getBasketballApiKey: () => "key",
      getGameById: jest.fn(() => Promise.resolve(game({ short: "FT", homeTotal: 108, awayTotal: 100 }))),
      getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock("../lib/sports/basketball/statProfiles", () => ({ getOrRefreshTeamProfile: jest.fn() }));
    const verifyFrozenPrediction = jest.fn(() => Promise.resolve(undefined));
    jest.doMock("../lib/sports/basketball/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve({ prediction: frozenPrediction(), status: "success" })),
      saveFrozenPrediction: jest.fn(),
      verifyFrozenPrediction,
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("bk-"),
    }));
    const { default: handler } = await import("../pages/api/basketball/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "A", awayTeamName: "B", season: "2025-2026" } }, res);

    expect(res.body.historyStatus).toBe("success");
    expect(verifyFrozenPrediction).not.toHaveBeenCalled();
  });

  test("match FINISHED, encore pending : verifyFrozenPrediction classe et fusionne le compte-rendu", async () => {
    jest.doMock("../lib/sports/basketball/provider", () => ({
      getBasketballApiKey: () => "key",
      getGameById: jest.fn(() => Promise.resolve(game({ short: "FT", homeTotal: 108, awayTotal: 100 }))),
      getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock("../lib/sports/basketball/statProfiles", () => ({ getOrRefreshTeamProfile: jest.fn() }));
    const verifyFrozenPrediction = jest.fn(() => Promise.resolve({ status: "success", prediction: { verification: { winner: true } } }));
    jest.doMock("../lib/sports/basketball/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve({ prediction: frozenPrediction(), status: "pending" })),
      saveFrozenPrediction: jest.fn(),
      verifyFrozenPrediction,
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("bk-"),
    }));
    const { default: handler } = await import("../pages/api/basketball/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "A", awayTeamName: "B", season: "2025-2026" } }, res);

    expect(verifyFrozenPrediction).toHaveBeenCalledTimes(1);
    expect(res.body.historyStatus).toBe("success");
    expect(res.body.verification).toEqual({ winner: true });
  });
});
