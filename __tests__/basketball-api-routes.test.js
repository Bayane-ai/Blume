/**
 * pages/api/basketball/live-matches.js + pages/api/basketball/matches.js — bloc 1 :
 * mêmes garanties que les routes football équivalentes (pages/api/live-matches.js/
 * matches.js), mais une seule source (API-SPORTS Basketball, pas de football-data.org
 * pour ce sport) — TOUTES les compétitions sans filtre, message clair en français en
 * cas d'échec (jamais un texte technique ni une page blanche).
 */
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function rawGame({ id, leagueId = 12, leagueName = "NBA", homeId, homeName, awayId, awayName, status = "Q2", date, homeScore = 10, awayScore = 8 }) {
  return {
    id,
    date: date || new Date().toISOString(),
    status: { long: status, short: status, timer: "5:00" },
    league: { id: leagueId, name: leagueName, logo: "" },
    country: { name: "USA" },
    teams: { home: { id: homeId, name: homeName, logo: "" }, away: { id: awayId, name: awayName, logo: "" } },
    scores: { home: { total: homeScore }, away: { total: awayScore } },
  };
}

beforeEach(() => {
  jest.resetModules();
  delete process.env.BALLDONTLIE_API_KEY;
  delete process.env.FORCE_SPORTSCORE_FAIL;
  jest.isolateModules(() => { require("../lib/routeCache").clearRouteCache(); });
  delete process.env.API_FOOTBALL_KEY;
  delete process.env.API_BASKETBALL_KEY;
});

describe("/api/basketball/live-matches", () => {
  test("sans clé configurée, message clair en français, jamais un texte technique", async () => {
    const { default: handler } = await import("../pages/api/basketball/live-matches.js");
    const res = mockRes();
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toMatch(/basket/i);
    expect(res.body.error).not.toMatch(/administrateur|undefined|NaN/i);
  });

  test("réutilise API_FOOTBALL_KEY quand API_BASKETBALL_KEY n'est pas définie, renvoie les vrais matchs mappés", async () => {
    process.env.API_FOOTBALL_KEY = "shared-key";
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: [
              rawGame({ id: 1, homeId: 10, homeName: "Lakers", awayId: 11, awayName: "Warriors" }),
              rawGame({ id: 2, leagueId: 20, leagueName: "EuroLeague", homeId: 30, homeName: "Real Madrid", awayId: 31, awayName: "Barcelona" }),
            ],
          }),
      })
    );
    const { default: handler } = await import("../pages/api/basketball/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.matches).toHaveLength(2);
    expect(res.body.matches[0].homeTeam.name).toBe("Lakers");
    expect(res.body.matches[1].competition.name).toBe("EuroLeague");
    // Toutes compétitions confondues, sans filtre : un seul appel à /games?live=all.
    expect(global.fetch.mock.calls[0][0]).toBe("https://v1.basketball.api-sports.io/games?live=all&page=1");
    // Pas encore de pronostic (bloc 3) : honnêtement indisponible, jamais inventé.
    expect(res.body.matches[0].pronostic).toEqual({ available: false });
  });

  test("panne de l'API : message clair en français (jamais de page blanche ni de texte technique)", async () => {
    process.env.API_FOOTBALL_KEY = "shared-key";
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
    const { default: handler } = await import("../pages/api/basketball/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.body.error).toMatch(/basket/i);
    expect(res.body.error).not.toMatch(/Error:|undefined|stack/i);
  });
});

describe("/api/basketball/matches — cascade complète jusqu'à balldontlie", () => {
  // Contrat balldontlie repris du SDK OFFICIEL (@balldontlie/sdk) : base
  // https://api.balldontlie.io, chemin /nba/v1/games, en-tête `Authorization: <clé>`
  // (clé BRUTE, sans « Bearer »), paramètres start_date/end_date/per_page/cursor,
  // pagination par `meta.next_cursor`.
  test("API-Basketball et SportScore à 0 : balldontlie prend le relais, curseur suivi", async () => {
    process.env.API_BASKETBALL_KEY = "cle";
    process.env.BALLDONTLIE_API_KEY = "bdl_test";
    const soon = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
    const appels = [];
    let page = 0;

    global.fetch = jest.fn((url, init) => {
      const u = String(url);
      appels.push({ u, auth: init?.headers?.Authorization });
      if (u.includes("api-sports.io")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ response: [] }) });
      }
      if (u.includes("sportscore")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ matches: [] }) });
      }
      page += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            {
              id: page,
              date: soon,
              status: "7:00 pm ET",
              home_team: { full_name: `Domicile ${page}` },
              visitor_team: { full_name: `Visiteur ${page}` },
            },
          ],
          meta: { next_cursor: page < 3 ? page + 1 : null },
        }),
      });
    });

    const { default: handler } = await import("../pages/api/basketball/matches.js");
    const res = mockRes();
    await handler({}, res);

    const bdl = appels.filter((a) => a.u.includes("/nba/v1/games"));
    expect(bdl.length).toBe(3); // les 3 pages du curseur ont bien été parcourues
    // Clé brute, jamais préfixée « Bearer » : c'est ce qu'attend l'API.
    expect(bdl[0].auth).toBe("bdl_test");
    expect(bdl[0].u).toContain("start_date=");
    expect(bdl[0].u).toContain("end_date=");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.matches).toHaveLength(3);
    expect(res.body.sources.map((x) => x.nom)).toEqual([
      "API-Basketball (v1.basketball.api-sports.io)",
      "SportScore (secours)",
      "balldontlie (NBA uniquement)",
    ]);
  });

  test("sans BALLDONTLIE_API_KEY : source déclarée non configurée, jamais une panne", async () => {
    process.env.API_BASKETBALL_KEY = "cle";
    delete process.env.BALLDONTLIE_API_KEY;
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ response: [], matches: [] }) }));

    const { default: handler } = await import("../pages/api/basketball/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const bdl = res.body.sources.find((x) => x.nom.startsWith("balldontlie"));
    expect(bdl).toMatchObject({ statut: "non configurée" });
    expect(bdl.erreur).toMatch(/BALLDONTLIE_API_KEY/);
  });

  test("timeout de 10 s posé sur chaque appel externe", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "lib", "sports", "basketball", "sources.js"), "utf8");
    expect(src).toContain("const TIMEOUT_MS = 10 * 1000");
    expect(src).toMatch(/AbortSignal\.timeout\(TIMEOUT_MS\)/);
  });
});

describe("/api/basketball/matches", () => {
  // Cette route ne doit JAMAIS renvoyer d'erreur HTTP : c'est un 502 muet (Promise.all
  // rejetée dès qu'UNE journée échouait) qui faisait disparaître les 7 autres journées
  // et affichait "0 match" côté site. Toujours 200 + diagnostic exploitable.
  test("sans clé configurée : 200 avec un diagnostic clair, jamais un 500", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ matches: [] }) }));
    const { default: handler } = await import("../pages/api/basketball/matches.js");
    const res = mockRes();
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const primary = res.body.diagnostic.sources[0];
    expect(primary.skipped).toBe(true);
    expect(primary.error).toMatch(/Clé API absente/i);
    // La source de secours a quand même été interrogée : une clé manquante sur la
    // source principale ne doit pas condamner tout le sport.
    expect(res.body.diagnostic.sources.map((x) => x.name)).toContain("SportScore (secours)");
  });

  test("regroupe les matchs par compétition RÉELLEMENT présente, toutes compétitions confondues", async () => {
    process.env.API_BASKETBALL_KEY = "dedicated-key";
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: [
              rawGame({ id: 1, status: "NS", homeId: 10, homeName: "Lakers", awayId: 11, awayName: "Warriors" }),
              rawGame({ id: 2, status: "NS", leagueId: 99, leagueName: "WNBA", homeId: 40, homeName: "Aces", awayId: 41, awayName: "Liberty" }),
            ],
          }),
      })
    );
    const { default: handler } = await import("../pages/api/basketball/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const codes = res.body.competitions.map((c) => c.name);
    expect(codes).toEqual(expect.arrayContaining(["NBA", "WNBA"]));
    // Un appel par date sur la fenêtre de 8 jours.
    expect(global.fetch.mock.calls.length).toBe(8);
    expect(global.fetch.mock.calls[0][1].headers).toEqual({ "x-apisports-key": "dedicated-key" });
  });

  test("panne totale : 200 + cause exacte, jamais un 502 muet", async () => {
    process.env.API_BASKETBALL_KEY = "dedicated-key";
    global.fetch = jest.fn(() => Promise.reject(new Error("network down")));
    const { default: handler } = await import("../pages/api/basketball/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.status).not.toHaveBeenCalledWith(502);
    expect(res.body.competitions).toEqual([]);
    expect(res.body.diagnostic.allSourcesFailed).toBe(true);
    expect(res.body.diagnostic.error).toMatch(/network down/i);
    expect(res.body.diagnostic.window.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("une seule journée en échec n'emporte plus les 7 autres (origine du 502)", async () => {
    process.env.API_BASKETBALL_KEY = "dedicated-key";
    let n = 0;
    global.fetch = jest.fn(() => {
      n += 1;
      if (n === 3) return Promise.reject(new Error("timeout"));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ response: [rawGame({ id: n, status: "NS", leagueId: 99, leagueName: "WNBA", homeId: 40, homeName: "Aces", awayId: 41, awayName: "Liberty" })] }),
      });
    });
    const { default: handler } = await import("../pages/api/basketball/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.competitions.map((c) => c.name)).toContain("WNBA");
    expect(res.body.diagnostic.received).toBeGreaterThan(0);
  });

  test("cascade : API-Basketball répond 0, SportScore est interrogé AVANT de conclure au vide", async () => {
    process.env.API_BASKETBALL_KEY = "dedicated-key";
    const soon = new Date(Date.now() + 5 * 3600000).toISOString();
    const calls = [];
    global.fetch = jest.fn((url) => {
      calls.push(String(url));
      if (String(url).includes("sportscore")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            matches: [{ id: 1, home_team: { name: "Minnesota Lynx" }, away_team: { name: "Las Vegas Aces" }, league: { name: "WNBA" }, start_at: soon, status: "not_started" }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    });

    const { default: handler } = await import("../pages/api/basketball/matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(calls.some((u) => u.includes("sportscore"))).toBe(true);
    expect(res.body.competitions.map((c) => c.name)).toEqual(["WNBA"]);
    expect(res.body.diagnostic.sources.map((x) => x.received)).toEqual([0, 1]);
  });
});
