/**
 * pages/api/tennis/live-matches.js + pages/api/tennis/matches.js — Live Tennis API :
 * live-matches renvoie les vrais matchs mappés (message clair en cas d'échec, jamais
 * un texte technique) ; matches (à venir) répond honnêtement `unsupported: true` —
 * ce plan gratuit n'a aucun endpoint de calendrier (voir lib/sports/tennis/provider.js).
 */
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function makeCacheMock() {
  const store = new Map();
  return {
    readPersistentCache: jest.fn((key) => {
      const entry = store.get(key);
      return Promise.resolve(entry ? { payload: entry.payload, fetchedAt: entry.fetchedAt } : null);
    }),
    writePersistentCache: jest.fn((key, payload) => store.set(key, { payload, fetchedAt: Date.now() })),
  };
}

function rawMatch({ id, tournamentName = "Wimbledon", category = "Grand Slam", homeId, homeName, awayId, awayName, status = "live" }) {
  return {
    id,
    date: new Date().toISOString(),
    status,
    tournament: { id: 12, name: tournamentName, surface: "grass", category, country: "United Kingdom" },
    player1: { id: homeId, name: homeName },
    player2: { id: awayId, name: awayName },
  };
}

beforeEach(() => {
  jest.resetModules();
  delete process.env.TENNIS_API_KEY;
});

describe("/api/tennis/live-matches", () => {
  test("sans clé configurée, message clair en français, jamais un texte technique", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { default: handler } = await import("../pages/api/tennis/live-matches.js");
    const res = mockRes();
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toMatch(/tennis/i);
    expect(res.body.error).not.toMatch(/administrateur|undefined|NaN/i);
  });

  test("clé configurée : renvoie les vrais matchs mappés, toutes catégories confondues (Challenger inclus)", async () => {
    process.env.TENNIS_API_KEY = "real-key";
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            matches: [
              rawMatch({ id: 1, homeId: 10, homeName: "Novak Djokovic", awayId: 11, awayName: "Carlos Alcaraz" }),
              rawMatch({ id: 2, tournamentName: "Challenger Lyon", category: "Challenger", homeId: 30, homeName: "Joueur A", awayId: 31, awayName: "Joueur B" }),
            ],
          }),
      })
    );
    const { default: handler } = await import("../pages/api/tennis/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.matches).toHaveLength(2);
    expect(res.body.matches[0].homeTeam.name).toBe("Novak Djokovic");
    expect(res.body.matches[1].competition.name).toBe("Challenger Lyon");
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.livetennisapi.com/api/public/v1/matches?status=live");
    expect(global.fetch.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer real-key" });
    expect(res.body.matches[0].pronostic).toEqual({ available: false });
  });

  test("panne de l'API (500) sans cache connu : message clair en français, jamais de page blanche", async () => {
    process.env.TENNIS_API_KEY = "real-key";
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("boom") }));
    const { default: handler } = await import("../pages/api/tennis/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.body.error).toMatch(/tennis/i);
    expect(res.body.error).not.toMatch(/Error:|undefined|stack/i);
  });

  test("réponse vide (0 match en direct) : ce n'est pas une erreur", async () => {
    process.env.TENNIS_API_KEY = "real-key";
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) }));
    const { default: handler } = await import("../pages/api/tennis/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.matches).toEqual([]);
  });
});

describe("/api/tennis/matches (à venir) — honnêtement non supporté par ce plan gratuit", () => {
  test("répond 200 avec unsupported:true et un message clair, jamais une erreur ni un plantage", async () => {
    const { default: handler } = await import("../pages/api/tennis/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.competitions).toEqual([]);
    expect(res.body.unsupported).toBe(true);
    expect(res.body.message).toMatch(/tennis/i);
  });
});
