/**
 * @jest-environment jsdom
 *
 * "Écran vide généralisé" (football-data.org en panne) : plus jamais un échec
 * silencieux. Ce fichier simule les 4 cas de figure demandés — 429 (quota), 401
 * (jeton invalide), réponse vide (0 match, mais réponse OK), et API qui ne répond pas
 * du tout (échec réseau) — et vérifie que dans les 4 cas, la route API renvoie
 * toujours quelque chose d'exploitable : soit les données fraîches, soit la dernière
 * copie connue (cache persistant, marquée `stale`), soit — seulement si RIEN d'autre
 * n'est disponible (ni cache, ni source secondaire) — une erreur explicite que le
 * frontend affiche déjà de façon lisible (voir pages/index.js, pages/a-venir.js).
 */
jest.mock("../lib/pronosticHistory", () => ({ maybeSweepFinishedPredictions: jest.fn() }));

const TOKEN = "test-token";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function fdMatch(id) {
  return {
    id,
    status: "IN_PLAY",
    minute: 40,
    utcDate: new Date().toISOString(),
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: id * 10, name: `Home ${id}`, crest: "" },
    awayTeam: { id: id * 10 + 1, name: `Away ${id}`, crest: "" },
    score: { fullTime: { home: 1, away: 0 } },
  };
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
  delete process.env.API_FOOTBALL_KEY;
});

// ---------------------------------------------------------------------------
// lib/liveListCache.js : les 4 scénarios, au niveau le plus bas.
// ---------------------------------------------------------------------------
describe("lib/liveListCache.js — jamais un échec silencieux, jamais une page vide s'il existe un cache", () => {
  test("429 (quota dépassé) SANS cache connu : erreur remontée telle quelle (rien d'autre à montrer)", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("quota exceeded") }));
    const { getLiveMatchesList } = await import("../lib/liveListCache.js");
    const result = await getLiveMatchesList(TOKEN);
    expect(result.errorStatus).toBe(429);
  });

  test("429 (quota dépassé) AVEC un cache persistant connu : sert la dernière liste connue, marquée stale", async () => {
    const persistedAt = Date.now() - 15 * 60 * 1000;
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn((key) =>
        key === "football-data:live_all" ? Promise.resolve({ payload: [fdMatch(1)], fetchedAt: persistedAt }) : Promise.resolve(null)
      ),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("quota exceeded") }));
    const { getLiveMatchesList } = await import("../lib/liveListCache.js");
    const result = await getLiveMatchesList(TOKEN);
    expect(result.errorStatus).toBeUndefined();
    expect(result.stale).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.lastUpdated).toBe(new Date(persistedAt).toISOString());
  });

  test("401 (jeton invalide) SANS cache : erreur remontée telle quelle", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("invalid token") }));
    const { getLiveMatchesList } = await import("../lib/liveListCache.js");
    const result = await getLiveMatchesList(TOKEN);
    expect(result.errorStatus).toBe(401);
  });

  test("réponse vide (200 OK, 0 match) : ce n'est PAS une erreur, juste une vraie liste vide", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) }));
    const { getLiveMatchesList } = await import("../lib/liveListCache.js");
    const result = await getLiveMatchesList(TOKEN);
    expect(result.errorStatus).toBeUndefined();
    expect(result.matches).toEqual([]);
  });

  test("l'API ne répond pas du tout (échec réseau) AVEC un cache connu : sert la dernière liste connue, marquée stale", async () => {
    const persistedAt = Date.now() - 5 * 60 * 1000;
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn((key) =>
        key === "football-data:live_all" ? Promise.resolve({ payload: [fdMatch(2)], fetchedAt: persistedAt }) : Promise.resolve(null)
      ),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.reject(new Error("ECONNRESET")));
    const { getLiveMatchesList } = await import("../lib/liveListCache.js");
    const result = await getLiveMatchesList(TOKEN);
    expect(result.stale).toBe(true);
    expect(result.matches).toHaveLength(1);
  });

  test("l'API ne répond pas du tout (échec réseau) SANS aucun cache : erreur remontée (500), jamais un plantage", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.reject(new Error("ECONNRESET")));
    const { getLiveMatchesList } = await import("../lib/liveListCache.js");
    const result = await getLiveMatchesList(TOKEN);
    expect(result.errorStatus).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// pages/api/live-matches.js : bascule sur API-Football si football-data.org échoue.
// ---------------------------------------------------------------------------
describe("pages/api/live-matches.js — bascule sur la source secondaire avant d'abandonner", () => {
  test("football-data.org en 429 SANS cache, mais API-Football a des matchs en direct : réponse 200 quand même", async () => {
    process.env.API_FOOTBALL_KEY = "af-key";
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn((url) => {
      if (url.includes("/v4/matches?")) return Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("quota") });
      if (url.includes("fixtures?live=all")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: [{
              fixture: { id: 99, date: new Date().toISOString(), status: { short: "2H", elapsed: 50 } },
              league: { id: 1, name: "Brasileirão", logo: "" },
              teams: { home: { id: 1, name: "Time A", logo: "" }, away: { id: 2, name: "Time B", logo: "" } },
              goals: { home: 1, away: 1 },
            }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    });

    const { default: handler } = await import("../pages/api/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).not.toHaveBeenCalledWith(429);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0].homeTeam.name).toBe("Time A");
  });

  test("football-data.org en 429 SANS cache ET aucune clé API-Football : erreur explicite (rien d'autre à montrer)", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("quota") }));

    const { default: handler } = await import("../pages/api/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.error).toEqual(expect.stringContaining("429"));
  });

  test("football-data.org en panne réseau AVEC un cache : la réponse contient les matchs en cache, marqués stale", async () => {
    const persistedAt = Date.now() - 8 * 60 * 1000;
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn((key) =>
        key === "football-data:live_all" ? Promise.resolve({ payload: [fdMatch(3)], fetchedAt: persistedAt }) : Promise.resolve(null)
      ),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.reject(new Error("réseau indisponible")));

    const { default: handler } = await import("../pages/api/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.stale).toBe(true);
    expect(res.body.matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// pages/api/matches.js (matchs à venir) : mêmes 4 scénarios.
// ---------------------------------------------------------------------------
describe("pages/api/matches.js — jamais un échec silencieux, cache persistant en repli", () => {
  test("401 (jeton invalide) SANS cache : erreur explicite", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("invalid token") }));

    const { default: handler } = await import("../pages/api/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.competitions).toBeUndefined();
    expect(res.body.error).toEqual(expect.stringContaining("401"));
  });

  test("401 AVEC un cache persistant des matchs à venir : sert le cache, marqué stale, jamais une erreur", async () => {
    const persistedAt = Date.now() - 30 * 60 * 1000;
    const cachedMatches = [{
      id: 777, status: "SCHEDULED", utcDate: new Date(Date.now() + 3600000).toISOString(),
      competition: { code: "PL", name: "Premier League", emblem: "" },
      homeTeam: { id: 1, name: "Cached Home", crest: "" },
      awayTeam: { id: 2, name: "Cached Away", crest: "" },
      score: { fullTime: { home: null, away: null } },
    }];
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn((key) =>
        key === "football-data:matches_main" ? Promise.resolve({ payload: cachedMatches, fetchedAt: persistedAt }) : Promise.resolve(null)
      ),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("invalid token") }));

    const { default: handler } = await import("../pages/api/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.error).toBeUndefined();
    expect(res.body.stale).toBe(true);
    const allMatches = res.body.competitions.flatMap((c) => c.matches);
    expect(allMatches.some((m) => m.id === 777)).toBe(true);
  });

  test("réponse vide (200 OK, 0 match) : ce n'est pas une erreur, juste 0 compétition affichée", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) }));

    const { default: handler } = await import("../pages/api/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.error).toBeUndefined();
    expect(res.body.competitions).toEqual([]);
  });

  test("l'API ne répond pas (échec réseau) SANS aucun cache : erreur 502 explicite, jamais un plantage silencieux", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    global.fetch = jest.fn(() => Promise.reject(new Error("timeout")));

    const { default: handler } = await import("../pages/api/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.error).toBeDefined();
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
