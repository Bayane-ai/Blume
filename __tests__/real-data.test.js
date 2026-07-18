/**
 * Vérifie que /api/matches et /api/competition-matches s'appuient sur de vraies données
 * (l'API football-data.org réelle) et n'inventent jamais de matchs supplémentaires :
 * si l'API en amont limite le nombre de matchs disponibles, la réponse en contient
 * exactement ce nombre, ni plus ni moins.
 */

const TOKEN = "test-token";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
});

test("/api/matches interroge la vraie API football-data.org (pas de données locales)", async () => {
  global.fetch = jest.fn((url) => {
    expect(url).toMatch(/^https:\/\/api\.football-data\.org\/v4\/matches\?/);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(global.fetch).toHaveBeenCalled();
  expect(res.body.error).toBeUndefined();
});

test("/api/matches n'invente jamais de matchs : la réponse contient exactement les matchs renvoyés par l'API, même en nombre réduit (quota)", async () => {
  // L'API en amont ne renvoie qu'un seul match (ex : quota atteint / plan gratuit limité).
  const onlyMatch = {
    id: 555,
    status: "SCHEDULED",
    utcDate: new Date(Date.now() + 3600000).toISOString(),
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 1, name: "Team A", crest: "" },
    awayTeam: { id: 2, name: "Team B", crest: "" },
    score: { fullTime: { home: null, away: null } },
  };

  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [onlyMatch] }) });
    }
    if (url.includes("/standings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const allMatches = res.body.competitions.flatMap((c) => c.matches);
  expect(allMatches).toHaveLength(1);
  expect(allMatches[0].id).toBe(555);
});

test("/api/matches ne masque pas les erreurs de l'API réelle derrière des matchs inventés", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.competitions).toBeUndefined();
  expect(res.body.error).toEqual(expect.stringContaining("429"));
});

test("/api/competition-matches interroge la vraie API football-data.org pour la compétition demandée", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/matches?")) {
      expect(url).toMatch(/^https:\/\/api\.football-data\.org\/v4\/competitions\/CL\/matches\?/);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/competition-matches.js");
  const res = mockRes();
  await handler({ query: { code: "CL" } }, res);

  expect(res.body.matches).toHaveLength(0);
});
