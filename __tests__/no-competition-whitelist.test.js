/**
 * Garde-fou : "aucune restriction par ligue, par pays ou par fédération" —
 * pages/api/live-matches.js et pages/api/matches.js doivent afficher TOUTE
 * compétition renvoyée par les API, jamais filtrer sur une liste fermée
 * (blanche ou noire) de compétitions/mots-clés. lib/competitions.js existe
 * mais sert uniquement à l'ordre d'affichage — jamais à restreindre.
 */
const fs = require("fs");
const path = require("path");

jest.mock("../lib/pronosticHistory", () => ({ maybeSweepFinishedPredictions: jest.fn() }));

const LIVE_MATCHES_SRC = fs.readFileSync(path.join(__dirname, "../pages/api/live-matches.js"), "utf8");
const MATCHES_SRC = fs.readFileSync(path.join(__dirname, "../pages/api/matches.js"), "utf8");

test("lib/bettableFilter.js (ancien filtre par mots-clés de compétition) n'existe plus", () => {
  expect(fs.existsSync(path.join(__dirname, "../lib/bettableFilter.js"))).toBe(false);
});

test("pages/api/live-matches.js n'importe aucun filtre de compétition et transmet les matchs football-data.org tels quels", () => {
  expect(LIVE_MATCHES_SRC).not.toMatch(/bettableFilter|isBettableCompetitionName/);
  expect(LIVE_MATCHES_SRC).toMatch(/const fdMatches = listResult\.matches \|\| \[\];/);
});

test("pages/api/matches.js n'importe aucun filtre de compétition et transmet les matchs football-data.org tels quels", () => {
  expect(MATCHES_SRC).not.toMatch(/bettableFilter|isBettableCompetitionName/);
  expect(MATCHES_SRC).toMatch(/const fdMatches = data\.matches \|\| \[\];/);
});

test("aucune liste fermée de compétitions (whitelist/blacklist) n'est utilisée pour filtrer les matchs API-Football", () => {
  // Les fixtures API-Football (afMatches) ne doivent être filtrées que par statut
  // (pas encore commencé / dédoublonnage par équipes) — jamais par ligue/pays.
  for (const src of [LIVE_MATCHES_SRC, MATCHES_SRC]) {
    expect(src).not.toMatch(/EXCLUDE_KEYWORDS|ALLOWED_COMPETITIONS|COMPETITION_WHITELIST|COMPETITION_BLACKLIST/);
    expect(src).not.toMatch(/f\?\.league\?\.name\)/); // plus aucun filtre sur le nom de ligue API-Football
  }
});

test("lib/competitions.js reste documenté comme une liste d'affichage uniquement, jamais un filtre", () => {
  const competitionsSrc = fs.readFileSync(path.join(__dirname, "../lib/competitions.js"), "utf8");
  expect(competitionsSrc).toMatch(/Ce n'est PAS une liste exhaustive ni un filtre/);
});

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
  process.env.FOOTBALL_DATA_TOKEN = "test-token";
  delete process.env.API_FOOTBALL_KEY;
});

test("une petite compétition nationale jamais répertoriée dans lib/competitions.js (ex : Azerbaïdjan) apparaît en direct, exactement comme les grandes ligues", async () => {
  const azMatch = {
    id: 1,
    status: "IN_PLAY",
    minute: 30,
    utcDate: new Date().toISOString(),
    competition: { code: "AZ1", name: "Premyer Liqa", area: { name: "Azerbaïdjan" }, emblem: "" },
    homeTeam: { id: 100, name: "Sabah Baku", crest: "" },
    awayTeam: { id: 101, name: "Qarabag FK", crest: "" },
    score: { fullTime: { home: 1, away: 1 } },
  };
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [azMatch] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
  });

  const { default: handler } = await import("../pages/api/live-matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.matches).toHaveLength(1);
  expect(res.body.matches[0].homeTeam.name).toBe("Sabah Baku");
  expect(res.body.matches[0].competition.name).toBe("Premyer Liqa");
});

test("une petite compétition nationale jamais répertoriée dans lib/competitions.js apparaît aussi côté matchs à venir", async () => {
  const azMatch = {
    id: 2,
    status: "SCHEDULED",
    utcDate: new Date(Date.now() + 3600000).toISOString(),
    competition: { code: "AZ1", name: "Premyer Liqa", area: { name: "Azerbaïdjan" }, emblem: "" },
    homeTeam: { id: 100, name: "Sabah Baku", crest: "" },
    awayTeam: { id: 101, name: "Qarabag FK", crest: "" },
    score: { fullTime: { home: null, away: null } },
  };
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [azMatch] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const codes = res.body.competitions.map((c) => c.code);
  expect(codes).toContain("AZ1");
  const az = res.body.competitions.find((c) => c.code === "AZ1");
  expect(az.matches[0].homeTeam.name).toBe("Sabah Baku");
});
