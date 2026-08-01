/**
 * pages/api/tennis/analyze.js — bloc 7 : croise les vrais profils des deux joueurs
 * pour produire un pronostic complet, recalcule en direct UNIQUEMENT probabilité de
 * victoire/scores en sets/totaux de jeux, garde le reste figé. Bloc 8 : fige le
 * pronostic (lib/sports/tennis/pronosticHistory.js — mocké ici, testé séparément dans
 * __tests__/tennis-pronostic-history.test.js), le vérifie automatiquement en fin de
 * match, et alimente la timeline "Moments forts" (lib/sports/tennis/timeline.js,
 * réelle ici — fonction pure, pas d'appel réseau).
 */
const KEY = "test-tennis-key";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function field(value) {
  return value == null
    ? { value: null, estimated: true, sampleSize: 0, available: false }
    : { value, estimated: false, sampleSize: 8, available: true };
}

function fullProfile(overrides = {}) {
  return {
    available: true, playerName: "Joueur", ranking: 10, form: "WWLWW", matchesUsed: 8,
    serveWinPct: field(64), returnWinPct: field(38), firstServeInPct: field(60),
    firstServeWonPct: field(68), secondServeWonPct: field(46),
    acesPerMatch: field(6), doubleFaultsPerMatch: field(2), breakPointsWonPct: field(40),
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetModules();
  process.env.API_TENNIS_KEY = KEY;
});

test("sans clé API : 500 explicite", async () => {
  delete process.env.API_TENNIS_KEY;
  delete process.env.API_FOOTBALL_KEY;
  const { default: handler } = await import("../pages/api/tennis/analyze.js");
  const res = mockRes();
  await handler({ query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(500);
});

test("paramètres manquants (pas d'identifiants de joueur) : 400 explicite", async () => {
  const { default: handler } = await import("../pages/api/tennis/analyze.js");
  const res = mockRes();
  await handler({ query: { matchId: "tn-1", homeTeamName: "A", awayTeamName: "B" } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});

describe("pronostic pas encore figé (première analyse)", () => {
  function mockModules({ gameObj = null, saveReturns = undefined, getFrozenReturns = null } = {}) {
    jest.doMock("../lib/sports/tennis/statProfiles", () => ({
      getOrBuildPlayerProfile: jest.fn(() => Promise.resolve(fullProfile())),
    }));
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY,
      getGameById: jest.fn(() => Promise.resolve(gameObj)),
      getGameStatistics: jest.fn(() => Promise.resolve([])),
      getHeadToHead: jest.fn(() => Promise.resolve([])),
    }));
    const saveFrozenPrediction = jest.fn(() => Promise.resolve(saveReturns));
    const getFrozenPrediction = jest.fn(() => Promise.resolve(getFrozenReturns));
    const verifyFrozenPrediction = jest.fn(() => Promise.resolve(undefined));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction, saveFrozenPrediction, verifyFrozenPrediction,
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    return { saveFrozenPrediction, getFrozenPrediction, verifyFrozenPrediction };
  }

  test("pronostic complet avant match : disponible, jamais vide, figé (saveFrozenPrediction appelé)", async () => {
    const { saveFrozenPrediction } = mockModules();
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "Djokovic", awayTeamName: "Alcaraz", surface: "Dur" } },
      res
    );
    expect(res.body.available).toBe(true);
    expect(res.body.probabilities).toBeDefined();
    expect(res.body.setScores.length).toBeGreaterThan(0);
    expect(res.body.matchStatus).toBe("SCHEDULED");
    expect(res.body.live).toBe(false);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(typeof res.body.timelineNote).toBe("string");
    expect(saveFrozenPrediction).toHaveBeenCalledTimes(1);
    expect(saveFrozenPrediction.mock.calls[0][0]).toMatchObject({ matchId: "tn-1", matchStatus: "SCHEDULED" });
  });

  test("identifiants 'tn-' correctement dépréfixés avant d'être transmis à l'API réelle", async () => {
    jest.doMock("../lib/sports/tennis/statProfiles", () => ({
      getOrBuildPlayerProfile: jest.fn(() => Promise.resolve(fullProfile())),
    }));
    const getHeadToHead = jest.fn(() => Promise.resolve([]));
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(null)),
      getGameStatistics: jest.fn(() => Promise.resolve([])), getHeadToHead,
    }));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve(null)),
      saveFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      verifyFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } },
      res
    );
    expect(getHeadToHead).toHaveBeenCalledWith("10", "11", KEY);
  });

  test("Grand Chelem masculin (category='Grand Slam') : bestOf=5, scores en sets jusqu'à 3 sets gagnants", async () => {
    mockModules();
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B", category: "Grand Slam" } },
      res
    );
    expect(res.body.bestOf).toBe(5);
    for (const s of res.body.setScores) expect(Math.max(...s.score.split("-").map(Number))).toBe(3);
  });

  test("Grand Chelem féminin (category='WTA - Grand Slam') : bestOf reste 3, jamais 5", async () => {
    mockModules();
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B", category: "WTA - Grand Slam" } },
      res
    );
    expect(res.body.bestOf).toBe(3);
  });

  test("match en direct : probabilité/scores en sets/totaux de jeux recalculés ; aces/breaks/tie-break/handicap restent figés ; timeline/serveur renseignés", async () => {
    const liveGame = {
      id: 555, status: { long: "Set 2", short: "Set2" },
      teams: { home: { id: 10, name: "A" }, away: { id: 11, name: "B" } },
      scores: {
        home: { set_1: 6, set_2: 3, game: 40, serve: true },
        away: { set_1: 4, set_2: 2, game: 30 },
      },
    };
    mockModules({ gameObj: liveGame });
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-555", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } },
      res
    );

    expect(res.body.live).toBe(true);
    expect(res.body.matchStatus).toBe("IN_PLAY");
    expect(res.body.probabilities.home).toBeGreaterThan(50);
    expect(res.body.aces.total.available).toBe(true);
    expect(res.body.breaks.total.available).toBe(true);
    expect(["Oui", "Non"]).toContain(res.body.tiebreak.likely);
    expect(res.body.gameHandicap.favorite).toBeDefined();
    expect(res.body.server).toBe("home");
    expect(res.body.matchMinute).toBe("40-30");
    expect(res.body.matchPeriod).toBe("Set 2");
    expect(res.body.sets).toEqual([{ home: 6, away: 4 }, { home: 3, away: 2 }]);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);
  });

  test("match déjà terminé dès la première analyse : classé immédiatement (saveFrozenPrediction renvoie historyStatus)", async () => {
    const finishedGame = {
      id: 1, status: { long: "Finished", short: "FT" },
      teams: { home: { id: 10 }, away: { id: 11 } },
      scores: { home: { set_1: 6, set_2: 6, total: 2 }, away: { set_1: 3, set_2: 4, total: 0 } },
    };
    mockModules({ gameObj: finishedGame, saveReturns: { status: "success", prediction: { verification: { winner: true } } } });
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } },
      res
    );
    expect(res.body.historyStatus).toBe("success");
    expect(res.body.verification).toEqual({ winner: true });
  });

  test("aucune erreur réseau ne casse la réponse : profils indisponibles -> 200 honnête, jamais un 500", async () => {
    jest.doMock("../lib/sports/tennis/statProfiles", () => ({
      getOrBuildPlayerProfile: jest.fn(() => Promise.resolve({ available: false, reason: "clé manquante" })),
    }));
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(null)),
      getGameStatistics: jest.fn(() => Promise.resolve([])), getHeadToHead: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve(null)),
      saveFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      verifyFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.available).toBe(false);
  });

  test("une erreur inattendue renvoie 500 avec un message explicite, jamais une page cassée silencieusement", async () => {
    jest.doMock("../lib/sports/tennis/statProfiles", () => ({
      getOrBuildPlayerProfile: jest.fn(() => Promise.reject(new Error("panne réseau"))),
    }));
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(null)),
      getGameStatistics: jest.fn(() => Promise.resolve([])), getHeadToHead: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve(null)),
      saveFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      verifyFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toBeTruthy();
  });
});

describe("pronostic déjà figé (relecture, jamais un nouveau calcul de profil)", () => {
  function frozenPrediction() {
    return {
      home: { name: "A" }, away: { name: "B" }, bestOf: 3, surface: "Dur",
      probabilities: { home: 60, away: 40 },
      setScores: [{ score: "3-1", winner: "p1", probability: 40 }],
      gameTotals: { total: { available: true, line: 36.5, side: "Plus", lines: [{ line: 36.5, side: "Plus" }] }, home: {}, away: {} },
      gameHandicap: { favorite: "home", safe: { line: 2.5, side: "Plus" }, risky: { line: 5.5, side: "Plus" } },
      setsBlock: { totalSets: { line: 2.5, side: "Plus" }, bothWinASet: "Oui", firstSetWinner: "home", firstSetGames: { available: true } },
      aces: { total: { available: true } }, doubleFaults: { total: { available: true } },
      breaks: { total: { available: true } }, tiebreak: { likely: "Oui" },
      serviceReturnContext: { home: {}, away: {} }, narrative: { winProbability: "A part favori..." },
      h2hUsed: false, h2hSummary: null, note: "n",
      modelState: { p1Hold: 0.65, p2Hold: 0.6, p1PointOnServe: 0.63, p2PointOnServe: 0.6, pSet: 0.55 },
    };
  }

  test("profils JAMAIS refetchés quand un pronostic figé existe déjà", async () => {
    const getOrBuildPlayerProfile = jest.fn();
    jest.doMock("../lib/sports/tennis/statProfiles", () => ({ getOrBuildPlayerProfile }));
    const liveGame = {
      id: 555, status: { long: "Set 1", short: "Set1" },
      teams: { home: { id: 10 }, away: { id: 11 } },
      scores: { home: { set_1: 3, game: 40 }, away: { set_1: 2, game: 30 } },
    };
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(liveGame)),
      getGameStatistics: jest.fn(() => Promise.resolve([])), getHeadToHead: jest.fn(),
    }));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve({ prediction: frozenPrediction(), status: "pending" })),
      saveFrozenPrediction: jest.fn(),
      verifyFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "tn-555", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } }, res);

    expect(getOrBuildPlayerProfile).not.toHaveBeenCalled();
    expect(res.body.available).toBe(true);
    expect(res.body.live).toBe(true);
  });

  test("match FINISHED, pronostic déjà classé (historyStatus déjà présent) : verifyFrozenPrediction jamais rappelé", async () => {
    jest.doMock("../lib/sports/tennis/statProfiles", () => ({ getOrBuildPlayerProfile: jest.fn() }));
    const finishedGame = {
      id: 1, status: { long: "Finished", short: "FT" },
      teams: { home: { id: 10 }, away: { id: 11 } },
      scores: { home: { set_1: 6, set_2: 6, total: 2 }, away: { set_1: 3, set_2: 4, total: 0 } },
    };
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(finishedGame)),
      getGameStatistics: jest.fn(() => Promise.resolve([])), getHeadToHead: jest.fn(),
    }));
    const verifyFrozenPrediction = jest.fn(() => Promise.resolve(undefined));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve({ prediction: { ...frozenPrediction() }, status: "success" })),
      saveFrozenPrediction: jest.fn(),
      verifyFrozenPrediction,
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } }, res);

    expect(res.body.historyStatus).toBe("success");
    expect(verifyFrozenPrediction).not.toHaveBeenCalled();
  });

  test("match FINISHED, encore pending : verifyFrozenPrediction classe et fusionne le compte-rendu", async () => {
    jest.doMock("../lib/sports/tennis/statProfiles", () => ({ getOrBuildPlayerProfile: jest.fn() }));
    const finishedGame = {
      id: 1, status: { long: "Finished", short: "FT" },
      teams: { home: { id: 10 }, away: { id: 11 } },
      scores: { home: { set_1: 6, set_2: 6, total: 2 }, away: { set_1: 3, set_2: 4, total: 0 } },
    };
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(finishedGame)),
      getGameStatistics: jest.fn(() => Promise.resolve([])), getHeadToHead: jest.fn(),
    }));
    const verifyFrozenPrediction = jest.fn(() => Promise.resolve({ status: "success", prediction: { verification: { winner: true } } }));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve({ prediction: frozenPrediction(), status: "pending" })),
      saveFrozenPrediction: jest.fn(),
      verifyFrozenPrediction,
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } }, res);

    expect(verifyFrozenPrediction).toHaveBeenCalledTimes(1);
    expect(res.body.historyStatus).toBe("success");
    expect(res.body.verification).toEqual({ winner: true });
  });
});
