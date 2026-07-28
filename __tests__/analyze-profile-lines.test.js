/**
 * pages/api/analyze.js — BLOC 2 : dès que les DEUX profils d'équipe (lib/
 * teamStatProfiles.js) sont réellement disponibles, les lignes de pronostics
 * viennent ENTIÈREMENT du croisement de ces deux profils (lib/pronosticFromProfiles.js)
 * — jamais un mélange avec l'ancien modèle (classement/forme récente). Sans les deux
 * profils, comportement inchangé (voir __tests__/pronostic-fallback.test.js et les
 * autres tests existants de cette route, qui continuent de passer sans modification).
 */
jest.mock("../lib/pronosticHistory", () => ({
  getFrozenPrediction: jest.fn(() => Promise.resolve(null)),
  saveFrozenPrediction: jest.fn(),
  verifyFrozenPrediction: jest.fn(),
  canPersistMatch: jest.fn(() => true),
}));

const TOKEN = "test-token";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function field(value) {
  return value == null
    ? { value: null, estimated: true, sampleSize: 0, available: false }
    : { value, estimated: false, sampleSize: 5, available: true };
}

function fullSplit(overrides = {}) {
  return {
    goalsFor: field(1.8), goalsAgainst: field(0.9),
    cornersFor: field(6), cornersAgainst: field(3),
    shots: field(14), shotsOnTarget: field(6),
    foulsCommitted: field(10), foulsSuffered: field(12),
    touches: field(null),
    offsides: field(2),
    yellowCards: field(2), redCards: field(0.1),
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
  // Aucun appel réseau attendu côté football-data.org dans ce parcours : les DEUX
  // profils déjà disponibles suffisent à générer un pronostic complet, sans classement.
  global.fetch = jest.fn(() => Promise.reject(new Error("Aucun appel réseau attendu dans ce test")));
});

test("les deux profils d'équipe sont disponibles : les lignes viennent du Bloc 2, jamais du classement", async () => {
  jest.doMock("../lib/teamStatProfiles", () => ({
    getExistingTeamProfile: (teamName) =>
      Promise.resolve({
        available: true,
        teamName,
        home: fullSplit({ goalsFor: field(2.2) }),
        away: fullSplit({ goalsFor: field(1.1) }),
      }),
  }));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "PD", homeTeamId: "100", awayTeamId: "200", homeTeamName: "Real Madrid", awayTeamName: "Barcelona" } },
    res
  );

  expect(res.body.available).toBe(true);
  // Attribution claire de la source réelle (voir components/PronosticResults.js, qui
  // affiche pronostic.home.source quand aucune position de classement n'est connue).
  expect(res.body.home.source).toBe("profil d'équipe (Bloc 1)");
  expect(res.body.away.source).toBe("profil d'équipe (Bloc 1)");
  expect(res.body.markets.totalGoals.lines[0].line % 1).toBe(0.5);
  expect(res.body.matchStats.corners.half.label).toBe("1ère mi-temps");
  // Touches : structure présente, honnêtement indisponible (aucune source ne la fournit).
  expect(res.body.matchStats.throwIns.total.available).toBe(false);
});

test("un seul profil disponible (l'autre équipe jamais analysée) : retombe entièrement sur l'ancien modèle, jamais un mélange des deux sources", async () => {
  jest.doMock("../lib/teamStatProfiles", () => ({
    getExistingTeamProfile: (teamName) =>
      Promise.resolve(
        teamName === "Real Madrid"
          ? { available: true, teamName, home: fullSplit(), away: fullSplit() }
          : { available: false, reason: "profil non calculé" }
      ),
  }));

  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "PD", homeTeamId: "100", awayTeamId: "200", homeTeamName: "Real Madrid", awayTeamName: "Barcelona" } },
    res
  );

  expect(res.body.available).toBe(true);
  expect(res.body.home.source).not.toBe("profil d'équipe (Bloc 1)");
});

test("aucun profil disponible : comportement strictement inchangé (ancien modèle, classement/forme récente)", async () => {
  jest.doMock("../lib/teamStatProfiles", () => ({
    getExistingTeamProfile: () => Promise.resolve({ available: false, reason: "profil non calculé" }),
  }));

  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "PD", homeTeamId: "100", awayTeamId: "200", homeTeamName: "Real Madrid", awayTeamName: "Barcelona" } },
    res
  );

  expect(res.body.available).toBe(true);
  expect(res.body.home.source).toBe("estimation moyenne");
});

test("deux matchs différents (profils différents) analysés séparément ne renvoient jamais le même jeu de lignes", async () => {
  jest.doMock("../lib/teamStatProfiles", () => ({
    getExistingTeamProfile: (teamName) =>
      Promise.resolve({
        available: true,
        teamName,
        home: fullSplit({ goalsFor: field(2.4), cornersFor: field(7) }),
        away: fullSplit({ goalsFor: field(0.8), cornersFor: field(3) }),
      }),
  }));

  const { default: handler } = await import("../pages/api/analyze.js");

  const resA = mockRes();
  await handler(
    { query: { competitionCode: "PD", homeTeamId: "100", awayTeamId: "200", homeTeamName: "Real Madrid", awayTeamName: "Barcelona" } },
    resA
  );

  jest.resetModules();
  jest.doMock("../lib/pronosticHistory", () => ({
    getFrozenPrediction: jest.fn(() => Promise.resolve(null)),
    saveFrozenPrediction: jest.fn(),
    verifyFrozenPrediction: jest.fn(),
    canPersistMatch: jest.fn(() => true),
  }));
  jest.doMock("../lib/teamStatProfiles", () => ({
    getExistingTeamProfile: (teamName) =>
      Promise.resolve({
        available: true,
        teamName,
        home: fullSplit({ goalsFor: field(1.1), cornersFor: field(4) }),
        away: fullSplit({ goalsFor: field(1.3), cornersFor: field(6) }),
      }),
  }));
  const { default: handlerB } = await import("../pages/api/analyze.js");
  const resB = mockRes();
  await handlerB(
    { query: { competitionCode: "PL", homeTeamId: "300", awayTeamId: "400", homeTeamName: "Arsenal", awayTeamName: "Chelsea" } },
    resB
  );

  expect(resA.body.markets).not.toEqual(resB.body.markets);
  expect(resA.body.matchStats).not.toEqual(resB.body.matchStats);
});
