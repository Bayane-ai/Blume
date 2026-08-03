/**
 * pages/api/tennis/analyze.js — calcule les 4 lignes de pronostic (voir lib/sports/
 * tennis/livePronostic.js) à partir du classement des deux joueurs et du score en
 * direct (Live Tennis API — historique/statistiques réelles indisponibles sur ce plan
 * gratuit). Fige le pronostic une seule fois (lib/sports/tennis/pronosticHistory.js,
 * mocké ici), le vérifie automatiquement en fin de match.
 */
const KEY = "test-tennis-key";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.resetModules();
  process.env.TENNIS_API_KEY = KEY;
});

afterEach(() => {
  delete process.env.TENNIS_API_KEY;
});

test("sans clé API : 500 explicite", async () => {
  delete process.env.TENNIS_API_KEY;
  const { default: handler } = await import("../pages/api/tennis/analyze.js");
  const res = mockRes();
  await handler({ query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(500);
});

test("identifiant de match manquant : 400 explicite", async () => {
  const { default: handler } = await import("../pages/api/tennis/analyze.js");
  const res = mockRes();
  await handler({ query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});

describe("pronostic pas encore figé (première analyse)", () => {
  function mockModules({ rawScore = null, playerHome = null, playerAway = null, saveReturns = undefined, getFrozenReturns = null } = {}) {
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY,
      getMatchScore: jest.fn(() => Promise.resolve(rawScore)),
      getPlayer: jest.fn((id) => Promise.resolve(id === "10" ? playerHome : id === "11" ? playerAway : null)),
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

  test("pronostic complet avant match : disponible, les 4 lignes présentes, figé (saveFrozenPrediction appelé)", async () => {
    const { saveFrozenPrediction } = mockModules({ playerHome: { ranking: 5 }, playerAway: { ranking: 50 } });
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "Djokovic", awayTeamName: "Alcaraz" } },
      res
    );
    expect(res.body.available).toBe(true);
    expect(res.body.probabilities).toBeDefined();
    expect(res.body.currentSetProbabilities).toBeDefined();
    expect(res.body.gameTotals).toBeDefined();
    expect(res.body.totalSets).toBeDefined();
    expect(res.body.matchStatus).toBe("SCHEDULED");
    expect(res.body.live).toBe(false);
    expect(saveFrozenPrediction).toHaveBeenCalledTimes(1);
    expect(saveFrozenPrediction.mock.calls[0][0]).toMatchObject({ matchId: "tn-1", matchStatus: "SCHEDULED" });
  });

  test("identifiants 'tn-' correctement dépréfixés avant d'être transmis à l'API réelle", async () => {
    const provider = { getPlayer: jest.fn(() => Promise.resolve(null)) };
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getMatchScore: jest.fn(() => Promise.resolve(null)), getPlayer: provider.getPlayer,
    }));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve(null)),
      saveFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      verifyFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } }, res);
    expect(provider.getPlayer).toHaveBeenCalledWith("10", KEY);
    expect(provider.getPlayer).toHaveBeenCalledWith("11", KEY);
  });

  test("Grand Chelem masculin (category='Grand Slam') : bestOf=5", async () => {
    mockModules();
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B", category: "Grand Slam" } },
      res
    );
    expect(res.body.bestOf).toBe(5);
    expect(res.body.totalSets.line).toBe(3.5);
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

  test("match en direct : les 4 lignes sont recalculées à partir du vrai score ; serveur/sets renseignés", async () => {
    const rawScore = { status: "live", sets: [{ p1: 6, p2: 3 }, { p1: 3, p2: 2 }], currentGame: { p1: 40, p2: 30 }, server: "player1" };
    mockModules({ rawScore });
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "tn-555", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } },
      res
    );

    expect(res.body.live).toBe(true);
    expect(res.body.matchStatus).toBe("IN_PLAY");
    expect(res.body.probabilities.home).toBeGreaterThan(50);
    expect(res.body.server).toBe("home");
    expect(res.body.matchMinute).toBe("40-30");
    expect(res.body.matchPeriod).toBe("Set 2");
    expect(res.body.sets).toEqual([{ home: 6, away: 3 }, { home: 3, away: 2 }]);
  });

  test("match déjà terminé dès la première analyse : classé immédiatement (saveFrozenPrediction renvoie historyStatus)", async () => {
    const rawScore = { status: "finished", sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }] };
    mockModules({ rawScore, saveReturns: { status: "success", prediction: { verification: { winner: true } } } });
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } }, res);
    expect(res.body.historyStatus).toBe("success");
    expect(res.body.verification).toEqual({ winner: true });
  });

  test("aucun classement connu pour les deux joueurs : pronostic quand même disponible (base neutre), jamais un 500", async () => {
    mockModules();
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.available).toBe(true);
    expect(res.body.probabilities.home).toBeCloseTo(50, 0);
  });

  test("une erreur inattendue renvoie 500 avec un message explicite, jamais une page cassée silencieusement", async () => {
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY,
      getMatchScore: jest.fn(() => Promise.reject(new Error("panne réseau"))),
      getPlayer: jest.fn(() => Promise.resolve(null)),
    }));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve(null)),
      saveFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      verifyFrozenPrediction: jest.fn(() => Promise.resolve(undefined)),
      canPersistMatch: (id) => typeof id === "string" && id.startsWith("tn-"),
    }));
    const { default: handler } = await import("../pages/api/tennis/analyze.js");
    const res = mockRes();
    await handler({ query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toBeTruthy();
  });
});

describe("pronostic déjà figé (relecture, jamais un nouveau calcul de classement)", () => {
  function frozenPrediction() {
    return {
      home: { name: "A", ranking: 5 }, away: { name: "B", ranking: 50 }, bestOf: 3,
      probabilities: { home: 60, away: 40 },
      currentSetProbabilities: { home: 55, away: 45 },
      gameTotals: { line: 22.5, side: "Plus", confidence: 60, lines: [{ line: 22.5, side: "Plus", confidence: 60 }] },
      totalSets: { line: 2.5, side: "Moins" },
      note: "n",
      modelState: { p1Hold: 0.65, p2Hold: 0.6, p1PointOnServe: 0.63, p2PointOnServe: 0.6, pSet: 0.55, bestOf: 3 },
    };
  }

  test("classement JAMAIS refetché quand un pronostic figé existe déjà", async () => {
    const getPlayer = jest.fn();
    const rawScore = { status: "live", sets: [{ p1: 3, p2: 2 }], currentGame: { p1: 40, p2: 30 } };
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getMatchScore: jest.fn(() => Promise.resolve(rawScore)), getPlayer,
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

    expect(getPlayer).not.toHaveBeenCalled();
    expect(res.body.available).toBe(true);
    expect(res.body.live).toBe(true);
  });

  test("match FINISHED, pronostic déjà classé (historyStatus déjà présent) : verifyFrozenPrediction jamais rappelé", async () => {
    const rawScore = { status: "finished", sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }] };
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getMatchScore: jest.fn(() => Promise.resolve(rawScore)), getPlayer: jest.fn(),
    }));
    const verifyFrozenPrediction = jest.fn(() => Promise.resolve(undefined));
    jest.doMock("../lib/sports/tennis/pronosticHistory", () => ({
      getFrozenPrediction: jest.fn(() => Promise.resolve({ prediction: { ...frozenPrediction(), historyStatus: "success" }, status: "success" })),
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
    const rawScore = { status: "finished", sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }] };
    jest.doMock("../lib/sports/tennis/provider", () => ({
      getTennisApiKey: () => KEY, getMatchScore: jest.fn(() => Promise.resolve(rawScore)), getPlayer: jest.fn(),
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
