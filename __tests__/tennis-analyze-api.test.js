/**
 * pages/api/tennis/analyze.js — bloc 7 : croise les vrais profils des deux joueurs
 * pour produire un pronostic complet, recalcule en direct UNIQUEMENT probabilité de
 * victoire/scores en sets/totaux de jeux, garde le reste figé.
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

test("pronostic complet avant match : disponible, jamais vide", async () => {
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({
    getOrBuildPlayerProfile: jest.fn(() => Promise.resolve(fullProfile())),
  }));
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => KEY,
    getGameById: jest.fn(() => Promise.resolve(null)),
    getHeadToHead: jest.fn(() => Promise.resolve([])),
  }));
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
});

test("identifiants 'tn-' correctement dépréfixés avant d'être transmis à l'API réelle", async () => {
  const getOrBuildPlayerProfile = jest.fn(() => Promise.resolve(fullProfile()));
  const getHeadToHead = jest.fn(() => Promise.resolve([]));
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({ getOrBuildPlayerProfile }));
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(null)), getHeadToHead,
  }));
  const { default: handler } = await import("../pages/api/tennis/analyze.js");
  const res = mockRes();
  await handler(
    { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } },
    res
  );
  expect(getOrBuildPlayerProfile.mock.calls[0][0].playerId).toBe("10");
  expect(getOrBuildPlayerProfile.mock.calls[1][0].playerId).toBe("11");
  expect(getHeadToHead).toHaveBeenCalledWith("10", "11", KEY);
});

test("Grand Chelem masculin (category='Grand Slam') : bestOf=5, scores en sets jusqu'à 3 sets gagnants", async () => {
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({
    getOrBuildPlayerProfile: jest.fn(() => Promise.resolve(fullProfile())),
  }));
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(null)), getHeadToHead: jest.fn(() => Promise.resolve([])),
  }));
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
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({
    getOrBuildPlayerProfile: jest.fn(() => Promise.resolve(fullProfile())),
  }));
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(null)), getHeadToHead: jest.fn(() => Promise.resolve([])),
  }));
  const { default: handler } = await import("../pages/api/tennis/analyze.js");
  const res = mockRes();
  await handler(
    { query: { matchId: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B", category: "WTA - Grand Slam" } },
    res
  );
  expect(res.body.bestOf).toBe(3);
});

test("match en direct : probabilité/scores en sets/totaux de jeux recalculés ; aces/breaks/tie-break/handicap restent figés", async () => {
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({
    getOrBuildPlayerProfile: jest.fn(() => Promise.resolve(fullProfile())),
  }));
  const liveGame = {
    id: 555, status: { long: "Set 2", short: "Set2" },
    teams: { home: { id: 10, name: "A" }, away: { id: 11, name: "B" } },
    scores: {
      home: { set_1: 6, set_2: 3, game: 40 },
      away: { set_1: 4, set_2: 2, game: 30 },
    },
  };
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(liveGame)), getHeadToHead: jest.fn(() => Promise.resolve([])),
  }));
  const { default: handler } = await import("../pages/api/tennis/analyze.js");
  const res = mockRes();
  await handler(
    { query: { matchId: "tn-555", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "A", awayTeamName: "B" } },
    res
  );

  expect(res.body.live).toBe(true);
  expect(res.body.matchStatus).toBe("IN_PLAY");
  // Joueur A mène 1 set à 0 et 3-2 dans le 2e -> sa probabilité de victoire doit être
  // strictement supérieure à celle calculée hors direct pour deux profils identiques.
  expect(res.body.probabilities.home).toBeGreaterThan(50);
  // Champs figés toujours présents et NON vides (jamais recalculés à zéro par erreur).
  expect(res.body.aces.total.available).toBe(true);
  expect(res.body.breaks.total.available).toBe(true);
  expect(["Oui", "Non"]).toContain(res.body.tiebreak.likely);
  expect(res.body.gameHandicap.favorite).toBeDefined();
});

test("aucune erreur réseau ne casse la réponse : profils indisponibles -> 200 honnête, jamais un 500", async () => {
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({
    getOrBuildPlayerProfile: jest.fn(() => Promise.resolve({ available: false, reason: "clé manquante" })),
  }));
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(null)), getHeadToHead: jest.fn(() => Promise.resolve([])),
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
    getTennisApiKey: () => KEY, getGameById: jest.fn(() => Promise.resolve(null)), getHeadToHead: jest.fn(() => Promise.resolve([])),
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
