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

describe("/api/tennis/matches — cascade SportScore puis Live Tennis API", () => {
  test("renvoie les vrais matchs, groupés par tournoi, avec un diagnostic source par source", async () => {
    const soon = new Date(Date.now() + 5 * 3600000).toISOString();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          matches: [
            { id: 1, home_team: { name: "Djokovic" }, away_team: { name: "Alcaraz" }, tournament: { name: "US Open" }, start_at: soon, status: "not_started" },
            { id: 2, home_team: { name: "Joueur C" }, away_team: { name: "Joueur D" }, tournament: { name: "ITF M15 Monastir" }, start_at: soon, status: "not_started" },
          ],
        }),
      })
    );

    const { default: handler } = await import("../pages/api/tennis/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(global.fetch.mock.calls[0][0]).toContain("sportscore.com");
    // Aucun refus écrit en dur : la liste dépend de ce que la source renvoie.
    expect(res.body.unsupported).toBeUndefined();
    // Les deux tournois sont là, le petit ITF comme le Grand Chelem.
    expect(res.body.competitions.map((c) => c.name).sort()).toEqual(["ITF M15 Monastir", "US Open"]);
    expect(res.body.diagnostic).toMatchObject({ received: 2, inWindow: 2, allSourcesFailed: false, anySourceFailed: false });
    expect(res.body.diagnostic.sources[0]).toMatchObject({ name: "SportScore", httpStatus: 200, received: 2 });
    expect(res.body.diagnostic.window.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.diagnostic.window.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("source principale en erreur : liste vide MAIS diagnostic exploitable, jamais un 502", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("down") }));

    const { default: handler } = await import("../pages/api/tennis/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.status).not.toHaveBeenCalledWith(502);
    expect(res.body.competitions).toEqual([]);
    const sportScore = res.body.diagnostic.sources.find((x) => x.name === "SportScore");
    expect(sportScore.error).toBe("HTTP 503");
    expect(sportScore.httpStatus).toBe(503);
    expect(res.body.diagnostic.anySourceFailed).toBe(true);
    expect(res.body.diagnostic.window.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("cascade : SportScore répond 0, Live Tennis API prend le relais AVANT toute conclusion au vide", async () => {
    process.env.TENNIS_API_KEY = "real-key";
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());

    const calls = [];
    global.fetch = jest.fn((url) => {
      calls.push(String(url));
      if (String(url).includes("sportscore")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ matches: [] }) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          matches: [rawMatch({ id: 77, tournamentName: "UTR Pro Tennis Hambourg", homeId: 1, homeName: "Joueur A", awayId: 2, awayName: "Joueur B", status: "live" })],
        }),
      });
    });

    const { default: handler } = await import("../pages/api/tennis/matches.js");
    const res = mockRes();
    await handler({}, res);

    // La source de secours a bien été interrogée, et elle a fourni le match.
    expect(calls.some((u) => u.includes("livetennisapi"))).toBe(true);
    expect(res.body.competitions.map((c) => c.name)).toEqual(["UTR Pro Tennis Hambourg"]);
    expect(res.body.diagnostic.sources.map((x) => x.name)).toEqual(["SportScore", "Live Tennis API (secours)"]);
    expect(res.body.diagnostic.sources[0].received).toBe(0);
    expect(res.body.diagnostic.sources[1].received).toBe(1);
  });

  test("aucun filtre de tournoi ni de circuit ; seule la fenêtre de dates écarte", async () => {
    const far = new Date(Date.now() + 9 * 24 * 3600000).toISOString();
    const soon = new Date(Date.now() + 2 * 3600000).toISOString();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          matches: [
            { id: 2, home_team: { name: "C" }, away_team: { name: "D" }, tournament: { name: "Trop tard" }, start_at: far, status: "not_started" },
            { id: 3, home_team: { name: "E" }, away_team: { name: "F" }, tournament: { name: "Challenger Obscur" }, start_at: soon, status: "not_started" },
            { id: 4, home_team: { name: "G" }, away_team: { name: "H" }, tournament: { name: "UTR Pro Tennis Saitama" }, start_at: soon, status: "inprogress" },
          ],
        }),
      })
    );

    const { default: handler } = await import("../pages/api/tennis/matches.js");
    const res = mockRes();
    await handler({}, res);

    // Le circuit secondaire ET le match en cours passent ; seul le hors-fenêtre sort.
    expect(res.body.competitions.map((c) => c.name).sort()).toEqual(["Challenger Obscur", "UTR Pro Tennis Saitama"]);
  });
});
