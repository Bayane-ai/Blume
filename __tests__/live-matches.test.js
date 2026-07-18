/**
 * Vérifie /api/live-matches : appelle la vraie API football-data.org avec le statut
 * LIVE, sans filtrer par compétition ni pays, n'invente jamais de matchs, et n'applique
 * aucun plafond artificiel — tous les matchs en direct renvoyés par l'API sont affichés.
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

function fixtureMatch(id, code) {
  return {
    id,
    status: "IN_PLAY",
    minute: 55,
    utcDate: new Date().toISOString(),
    competition: { code, name: `Compétition ${code}`, emblem: "" },
    homeTeam: { id: id * 10, name: `Home ${id}`, crest: "" },
    awayTeam: { id: id * 10 + 1, name: `Away ${id}`, crest: "" },
    score: { fullTime: { home: 1, away: 0 } },
  };
}

test("interroge la vraie API avec status=LIVE, sans filtre de compétition dans l'URL", async () => {
  global.fetch = jest.fn((url) => {
    expect(url).toBe("https://api.football-data.org/v4/matches?status=LIVE&limit=100");
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
  });

  const { default: handler } = await import("../pages/api/live-matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(res.body.matches).toEqual([]);
});

test("n'invente jamais de matchs : si l'API n'en renvoie que 3, la réponse en contient exactement 3", async () => {
  const threeMatches = [fixtureMatch(1, "PL"), fixtureMatch(2, "PD"), fixtureMatch(3, "SA")];
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: threeMatches }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
  });

  const { default: handler } = await import("../pages/api/live-matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.matches).toHaveLength(3);
  expect(res.body.matches.map((m) => m.id).sort()).toEqual([1, 2, 3]);
});

test("n'applique aucun plafond artificiel : si l'API renvoie 35 matchs en direct, les 35 sont affichés", async () => {
  const many = Array.from({ length: 35 }, (_, i) => fixtureMatch(i + 1, "PL"));
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: many }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
  });

  const { default: handler } = await import("../pages/api/live-matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.matches).toHaveLength(35);
});

test("un match d'une compétition présente en fin de liste (ex : Coupe du Monde) n'est pas tronqué", async () => {
  // Reproduit le bug rapporté : un match de Coupe du Monde arrivant après plus de 20
  // autres matchs en direct dans la réponse de l'API ne doit plus être coupé.
  const otherMatches = Array.from({ length: 22 }, (_, i) => fixtureMatch(i + 1, "PL"));
  const worldCupMatch = fixtureMatch(999, "WC");
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [...otherMatches, worldCupMatch] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
  });

  const { default: handler } = await import("../pages/api/live-matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.matches.some((m) => m.id === 999)).toBe(true);
});

test("chaque match renvoyé porte déjà son pronostic (calculé côté serveur)", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fixtureMatch(1, "PL")] }) });
    }
    if (url.includes("/standings")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            standings: [{ table: [
              { position: 1, points: 10, form: null, playedGames: 5, goalsFor: 8, goalsAgainst: 2, team: { id: 10 } },
              { position: 2, points: 9, form: null, playedGames: 5, goalsFor: 6, goalsAgainst: 3, team: { id: 11 } },
            ] }],
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/live-matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.matches[0].pronostic.available).toBe(true);
});

test("propage une vraie erreur API (ex: quota) au lieu de la masquer", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));

  const { default: handler } = await import("../pages/api/live-matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.matches).toBeUndefined();
  expect(res.body.error).toEqual(expect.stringContaining("429"));
});

test("plusieurs visiteurs qui actualisent en même temps ne déclenchent qu'un seul appel réel à l'API en amont", async () => {
  const fetchMock = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fixtureMatch(1, "PL")] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
  });
  global.fetch = fetchMock;

  const { default: handler } = await import("../pages/api/live-matches.js");
  // Simule 5 visiteurs qui rechargent la liste au même moment.
  await Promise.all(
    Array.from({ length: 5 }, () => handler({}, mockRes()))
  );

  const matchesCalls = fetchMock.mock.calls.filter(([url]) => url.includes("/v4/matches?")).length;
  expect(matchesCalls).toBe(1);
});
