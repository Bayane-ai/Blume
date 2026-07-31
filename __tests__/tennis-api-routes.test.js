/**
 * pages/api/tennis/live-matches.js + pages/api/tennis/matches.js — bloc 5 : mêmes
 * garanties que les routes football/basket équivalentes — TOUTES les catégories sans
 * filtre (ATP, WTA, Grand Chelem, Masters 1000, ATP 250/500, Challengers, ITF),
 * message clair en français en cas d'échec (jamais un texte technique ni une page
 * blanche).
 */
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function rawGame({ id, leagueId = 12, leagueName = "Wimbledon", category = "Grand Slam", homeId, homeName, awayId, awayName, status = "Set2", date, homeSet1 = 6, awaySet1 = 4 }) {
  return {
    id,
    date: date || new Date().toISOString(),
    status: { long: status, short: status },
    league: { id: leagueId, name: leagueName, logo: "", type: category, surface: "grass" },
    country: { name: "United Kingdom" },
    teams: { home: { id: homeId, name: homeName, logo: "" }, away: { id: awayId, name: awayName, logo: "" } },
    scores: { home: { set_1: homeSet1, game: 40 }, away: { set_1: awaySet1, game: 30 } },
  };
}

beforeEach(() => {
  jest.resetModules();
  delete process.env.API_FOOTBALL_KEY;
  delete process.env.API_TENNIS_KEY;
});

describe("/api/tennis/live-matches", () => {
  test("sans clé configurée, message clair en français, jamais un texte technique", async () => {
    const { default: handler } = await import("../pages/api/tennis/live-matches.js");
    const res = mockRes();
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toMatch(/tennis/i);
    expect(res.body.error).not.toMatch(/administrateur|undefined|NaN/i);
  });

  test("réutilise API_FOOTBALL_KEY quand API_TENNIS_KEY n'est pas définie, renvoie les vrais matchs mappés, toutes catégories confondues", async () => {
    process.env.API_FOOTBALL_KEY = "shared-key";
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: [
              rawGame({ id: 1, homeId: 10, homeName: "Novak Djokovic", awayId: 11, awayName: "Carlos Alcaraz" }),
              rawGame({ id: 2, leagueId: 20, leagueName: "Challenger Lyon", category: "Challenger", homeId: 30, homeName: "Joueur A", awayId: 31, awayName: "Joueur B" }),
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
    // Catégorie Challenger jamais filtrée (voir PROMPT bloc 5, point 3).
    expect(res.body.matches[1].competition.name).toBe("Challenger Lyon");
    expect(global.fetch.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/games?live=all");
    // Pas encore de pronostic (bloc 7) : honnêtement indisponible, jamais inventé.
    expect(res.body.matches[0].pronostic).toEqual({ available: false });
  });

  test("panne de l'API : message clair en français (jamais de page blanche ni de texte technique)", async () => {
    process.env.API_FOOTBALL_KEY = "shared-key";
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
    const { default: handler } = await import("../pages/api/tennis/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.body.error).toMatch(/tennis/i);
    expect(res.body.error).not.toMatch(/Error:|undefined|stack/i);
  });
});

describe("/api/tennis/matches", () => {
  test("sans clé configurée, message clair en français", async () => {
    const { default: handler } = await import("../pages/api/tennis/matches.js");
    const res = mockRes();
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toMatch(/tennis/i);
  });

  test("regroupe les matchs par tournoi RÉELLEMENT présent, toutes catégories confondues (ATP/WTA/Grand Chelem/Masters/250/500/Challenger/ITF)", async () => {
    process.env.API_TENNIS_KEY = "dedicated-key";
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: [
              rawGame({ id: 1, status: "NS", homeId: 10, homeName: "Novak Djokovic", awayId: 11, awayName: "Carlos Alcaraz" }),
              rawGame({ id: 2, status: "NS", leagueId: 99, leagueName: "ITF Antalya", category: "ITF", homeId: 40, homeName: "Joueur C", awayId: 41, awayName: "Joueur D" }),
            ],
          }),
      })
    );
    const { default: handler } = await import("../pages/api/tennis/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const names = res.body.competitions.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Wimbledon", "ITF Antalya"]));
    const itf = res.body.competitions.find((c) => c.name === "ITF Antalya");
    expect(itf.category).toBe("ITF");
    // Un appel par date sur la fenêtre de 8 jours.
    expect(global.fetch.mock.calls.length).toBe(8);
    expect(global.fetch.mock.calls[0][1].headers).toEqual({ "x-apisports-key": "dedicated-key" });
  });

  test("panne de l'API : message clair, jamais un plantage", async () => {
    process.env.API_TENNIS_KEY = "dedicated-key";
    global.fetch = jest.fn(() => Promise.reject(new Error("network down")));
    const { default: handler } = await import("../pages/api/tennis/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.body.error).toMatch(/pas disponibles/i);
  });
});
