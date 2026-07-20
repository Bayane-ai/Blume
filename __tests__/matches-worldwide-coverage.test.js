/**
 * pages/api/matches.js — "Matchs à venir" doit afficher TOUTES les fédérations et
 * TOUTES les compétitions réellement renvoyées par les API, sans filtre ni exception
 * (ligues nationales de tous les pays, coupes, compétitions internationales, jeunes
 * U17/U19/U20...) — jamais une compétition écartée simplement parce qu'elle n'est pas
 * dans la liste des compétitions majeures connues (lib/competitions.js).
 */
const FD_TOKEN = "test-fd-token";
const AF_KEY = "test-af-key";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function fdMatch(id, code, name, overrides = {}) {
  return {
    id, status: "SCHEDULED", utcDate: new Date(Date.now() + 3600000).toISOString(),
    competition: { code, name, emblem: "" },
    homeTeam: { id: id * 10, name: `Domicile ${id}`, crest: "" },
    awayTeam: { id: id * 10 + 1, name: `Extérieur ${id}`, crest: "" },
    score: { fullTime: { home: null, away: null } },
    ...overrides,
  };
}

function afFixture(i, { leagueId = 900 + i, leagueName = `Championnat ${i}`, country = "Pays X", status = "NS" } = {}) {
  return {
    fixture: { id: 5000 + i, date: new Date(Date.now() + 2 * 3600000).toISOString(), status: { short: status } },
    league: { id: leagueId, name: leagueName, country, logo: "" },
    teams: {
      home: { id: 6000 + i, name: `Domicile AF ${i}`, logo: "" },
      away: { id: 7000 + i, name: `Extérieur AF ${i}`, logo: "" },
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = FD_TOKEN;
  delete process.env.API_FOOTBALL_KEY;
});

test("une compétition football-data.org qui n'est PAS dans la liste des compétitions majeures connues apparaît quand même — bug corrigé", async () => {
  // "CLI" (Copa Libertadores) n'est volontairement pas dans lib/competitions.js : sert
  // ici de compétition réelle mais non répertoriée, pour vérifier qu'elle n'est plus
  // écartée par erreur.
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ matches: [fdMatch(1, "PL", "Premier League"), fdMatch(2, "CLI", "Copa Libertadores")] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const codes = res.body.competitions.map((c) => c.code);
  expect(codes).toContain("PL");
  expect(codes).toContain("CLI");
  const cli = res.body.competitions.find((c) => c.code === "CLI");
  expect(cli.name).toBe("Copa Libertadores");
  expect(cli.matches).toHaveLength(1);
});

test("les compétitions majeures connues gardent leur ordre de priorité habituel, les autres compétitions réelles suivent, triées alphabétiquement", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            matches: [
              fdMatch(1, "ZZZ", "Zeta Zone Cup"),
              fdMatch(2, "FL1", "Ligue 1"),
              fdMatch(3, "AAA", "Alpha Athletic Cup"),
              fdMatch(4, "PL", "Premier League"),
            ],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const codes = res.body.competitions.map((c) => c.code);
  // PL avant FL1 (ordre de lib/competitions.js), tous deux avant AAA/ZZZ (inconnues,
  // triées alphabétiquement par nom : "Alpha..." avant "Zeta...").
  expect(codes.indexOf("PL")).toBeLessThan(codes.indexOf("FL1"));
  expect(codes.indexOf("FL1")).toBeLessThan(codes.indexOf("AAA"));
  expect(codes.indexOf("AAA")).toBeLessThan(codes.indexOf("ZZZ"));
});

test("plusieurs fédérations différentes s'affichent bien ensemble dans une seule réponse (Europe, Amérique du Sud, compétition inconnue)", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            matches: [
              fdMatch(1, "PL", "Premier League"),
              fdMatch(2, "BSA", "Campeonato Brasileiro Série A"),
              fdMatch(3, "CLI", "Copa Libertadores"),
            ],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const names = res.body.competitions.map((c) => c.name);
  expect(names).toEqual(expect.arrayContaining(["Premier League", "Campeonato Brasileiro Série A", "Copa Libertadores"]));
});

test("avec API_FOOTBALL_KEY, les vrais matchs à venir supplémentaires (autres fédérations seniors) sont ajoutés, jamais dupliqués", async () => {
  process.env.API_FOOTBALL_KEY = AF_KEY;
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fdMatch(1, "PL", "Premier League")] }) });
    }
    if (url.includes("v3.football.api-sports.io/fixtures")) {
      // Une seule vraie date renvoie un match ; les autres jours sont vides.
      const parsed = new URL(url);
      const date = parsed.searchParams.get("date");
      const todayIso = new Date().toISOString().slice(0, 10);
      if (date === todayIso) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: [afFixture(1, { leagueName: "Eredivisie", country: "Pays-Bas" })] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const allMatches = res.body.competitions.flatMap((c) => c.matches);
  expect(allMatches).toHaveLength(2);
  const comp = res.body.competitions.find((c) => c.name === "Eredivisie");
  expect(comp).toBeDefined();
  expect(comp.matches[0].pronostic).toEqual({ available: false });
  expect(comp.matches[0].id).toBe("af-5001");
});

test('"les matchs sur lesquels on peut parier" : les catégories jeunes/réserves/amateurs sont écartées, aussi bien côté football-data.org que côté API-Football', async () => {
  process.env.API_FOOTBALL_KEY = AF_KEY;
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            matches: [
              fdMatch(1, "PL", "Premier League"),
              fdMatch(2, "U20WC", "Coupe du Monde U20"),
              fdMatch(3, "RES", "Reserve League"),
            ],
          }),
      });
    }
    if (url.includes("v3.football.api-sports.io/fixtures")) {
      const parsed = new URL(url);
      const date = parsed.searchParams.get("date");
      const todayIso = new Date().toISOString().slice(0, 10);
      if (date === todayIso) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: [afFixture(1, { leagueName: "Copa Sub-20" }), afFixture(2, { leagueName: "Amateur Cup" })] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const names = res.body.competitions.map((c) => c.name);
  expect(names).toEqual(["Premier League"]);
  const allMatches = res.body.competitions.flatMap((c) => c.matches);
  expect(allMatches).toHaveLength(1);
  expect(allMatches[0].id).toBe(1);
});

test("un match API-Football qui correspond déjà à un match football-data.org (mêmes équipes) n'est jamais dupliqué", async () => {
  process.env.API_FOOTBALL_KEY = AF_KEY;
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ matches: [fdMatch(1, "PL", "Premier League", { homeTeam: { id: 10, name: "Arsenal FC", crest: "" }, awayTeam: { id: 11, name: "Chelsea FC", crest: "" } })] }),
      });
    }
    if (url.includes("v3.football.api-sports.io/fixtures")) {
      const dup = afFixture(1, { leagueName: "Premier League" });
      dup.teams = { home: { id: 999, name: "Arsenal", logo: "" }, away: { id: 998, name: "Chelsea", logo: "" } };
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [dup] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const allMatches = res.body.competitions.flatMap((c) => c.matches);
  expect(allMatches).toHaveLength(1);
});

test("seuls les matchs API-Football pas encore commencés (statut NS) sont ajoutés — jamais un match en direct ou terminé mélangé ici", async () => {
  process.env.API_FOOTBALL_KEY = AF_KEY;
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.includes("v3.football.api-sports.io/fixtures")) {
      const parsed = new URL(url);
      const date = parsed.searchParams.get("date");
      const todayIso = new Date().toISOString().slice(0, 10);
      if (date === todayIso) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: [afFixture(1, { status: "1H" }), afFixture(2, { status: "FT" })] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const allMatches = res.body.competitions.flatMap((c) => c.matches);
  expect(allMatches).toHaveLength(0);
});

test("sans API_FOOTBALL_KEY, aucun appel n'est fait à API-Football — seuls les vrais matchs football-data.org sont affichés", async () => {
  const fetchMock = jest.fn((url) => {
    if (url.includes("/v4/matches?")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fdMatch(1, "PL", "Premier League")] }) });
    if (url.includes("api-sports")) throw new Error("Ne devrait jamais être appelé sans clé");
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });
  global.fetch = fetchMock;

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const allMatches = res.body.competitions.flatMap((c) => c.matches);
  expect(allMatches).toHaveLength(1);
  expect(fetchMock.mock.calls.some(([url]) => url.includes("api-sports"))).toBe(false);
});

test("une panne d'API-Football ne casse jamais la page ni ne vide la liste — juste les matchs football-data.org déjà réels", async () => {
  process.env.API_FOOTBALL_KEY = AF_KEY;
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fdMatch(1, "PL", "Premier League")] }) });
    if (url.includes("v3.football.api-sports.io/fixtures")) return Promise.resolve({ ok: false, status: 500 });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.error).toBeUndefined();
  const allMatches = res.body.competitions.flatMap((c) => c.matches);
  expect(allMatches).toHaveLength(1);
  expect(allMatches[0].id).toBe(1);
});
