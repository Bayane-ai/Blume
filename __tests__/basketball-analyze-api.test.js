/**
 * pages/api/basketball/analyze.js — bloc 3 : orchestre profils réels + statistiques
 * de joueurs pour produire le pronostic basket complet. Mock des sources de données
 * (provider/statProfiles), jamais un vrai appel réseau dans ces tests.
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

beforeEach(() => {
  jest.resetModules();
  global.fetch = jest.fn(() => Promise.reject(new Error("Aucun appel réseau attendu (sources mockées)")));
});

test("sans clé API basket configurée : erreur explicite, aucun calcul", async () => {
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => null,
    getGameById: jest.fn(),
    getTeamPlayerStatistics: jest.fn(),
  }));
  const { default: handler } = await import("../pages/api/basketball/analyze.js");
  const res = mockRes();
  await handler({ query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.body.available).toBe(false);
});

test("identifiants d'équipe manquants : 400 explicite", async () => {
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "key",
    getGameById: jest.fn(() => Promise.resolve(null)),
    getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { default: handler } = await import("../pages/api/basketball/analyze.js");
  const res = mockRes();
  await handler({ query: { matchId: "bk-1", season: "2025-2026" } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});

test("profil d'équipe indisponible : réponse honnête, jamais un pronostic inventé", async () => {
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "key",
    getGameById: jest.fn(() => Promise.resolve(null)),
    getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/basketball/statProfiles", () => ({
    getOrRefreshTeamProfile: jest.fn(({ teamId }) =>
      Promise.resolve(String(teamId) === "10" ? { available: false, reason: "aucun match récent" } : fullProfile())
    ),
  }));
  const { default: handler } = await import("../pages/api/basketball/analyze.js");
  const res = mockRes();
  await handler({ query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", season: "2025-2026" } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body.available).toBe(false);
  expect(typeof res.body.reason).toBe("string");
});

test("match pas encore commencé : pronostic complet, pas de liveOffset, 1ère mi-temps affichée", async () => {
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "key",
    getGameById: jest.fn(() => Promise.resolve({
      id: 1, status: { short: "NS" }, league: { season: "2025-2026" },
      scores: { home: { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, total: null },
                away: { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, total: null } },
    })),
    getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/basketball/statProfiles", () => ({
    getOrRefreshTeamProfile: jest.fn(() => Promise.resolve(fullProfile())),
  }));
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
});

test("match en direct au 3ème quart-temps : liveOffset appliqué, libellé bascule sur 2ème mi-temps", async () => {
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "key",
    getGameById: jest.fn(() => Promise.resolve({
      id: 1, status: { short: "Q3", timer: "5:00" }, league: { season: "2025-2026" },
      scores: { home: { quarter_1: 28, quarter_2: 26, quarter_3: null, quarter_4: null, total: 54 },
                away: { quarter_1: 24, quarter_2: 25, quarter_3: null, quarter_4: null, total: 49 } },
    })),
    getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/basketball/statProfiles", () => ({
    getOrRefreshTeamProfile: jest.fn(() => Promise.resolve(fullProfile())),
  }));
  const { default: handler } = await import("../pages/api/basketball/analyze.js");
  const res = mockRes();
  await handler(
    { query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "A", awayTeamName: "B", season: "2025-2026" } },
    res
  );
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body.live).toBe(true);
  expect(res.body.matchStatus).toBe("IN_PLAY");
  expect(res.body.matchScore).toEqual({ home: 54, away: 49 });
  expect(res.body.periods.activeHalfLabel).toBe("Total 2ème mi-temps");
  // Le score déjà acquis (54+49) doit peser dans le total attendu (bien au-delà des
  // seuls points restants) — jamais un total purement pré-match.
  expect(res.body.goals.expectedTotal).toBeGreaterThan(54 + 49);
});

test("saison introuvable (ni dans l'URL ni via le match) : réponse honnête plutôt qu'un calcul faux", async () => {
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "key",
    getGameById: jest.fn(() => Promise.resolve(null)),
    getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/basketball/statProfiles", () => ({
    getOrRefreshTeamProfile: jest.fn(() => Promise.resolve(fullProfile())),
  }));
  const { default: handler } = await import("../pages/api/basketball/analyze.js");
  const res = mockRes();
  await handler({ query: { matchId: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11" } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body.available).toBe(false);
});
