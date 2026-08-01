/**
 * pages/api/analyze.js — signalement réel : les matchs connus UNIQUEMENT par
 * API-Football (petites fédérations absentes de football-data.org, ex. Russie/Japon)
 * restaient indéfiniment sur "estimation moyenne" (jamais une vraie analyse) parce que
 * seule une LECTURE (getExistingTeamProfile) était faite, jamais un calcul RÉEL
 * (getOrRefreshTeamProfile) — contrairement au basket, qui l'attend déjà (voir
 * pages/api/basketball/analyze.js). Ce fichier vérifie le correctif : pour un match
 * "af-", le calcul réel est bien déclenché, ET si ce calcul échoue malgré tout (équipe
 * introuvable), le match garde une analyse dégradée mais cohérente (jamais vide).
 */
jest.mock("../lib/pronosticHistory", () => ({
  getFrozenPrediction: jest.fn(() => Promise.resolve(null)),
  saveFrozenPrediction: jest.fn(),
  verifyFrozenPrediction: jest.fn(),
  canPersistMatch: jest.fn(() => true),
}));

const TOKEN = "test-fd-token";
const AF_KEY = "test-af-key";

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
    goalsFor: field(1.6), goalsAgainst: field(1.1),
    cornersFor: field(5), cornersAgainst: field(4),
    shots: field(12), shotsOnTarget: field(5),
    foulsCommitted: field(11), foulsSuffered: field(10),
    touches: field(null),
    offsides: field(2),
    yellowCards: field(2.2), redCards: field(0.1),
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
  process.env.API_FOOTBALL_KEY = AF_KEY;
  global.fetch = jest.fn(() => Promise.reject(new Error("Aucun appel réseau football-data.org attendu pour un match af-")));
});

test('match "af-" : getOrRefreshTeamProfile (calcul RÉEL) est appelé, jamais getExistingTeamProfile (simple lecture) — analyse complète à partir des vraies performances', async () => {
  const getOrRefreshTeamProfile = jest.fn(({ teamName }) =>
    Promise.resolve({
      available: true,
      teamName,
      home: fullSplit({ goalsFor: field(2.1) }),
      away: fullSplit({ goalsFor: field(0.9) }),
    })
  );
  const getExistingTeamProfile = jest.fn();
  jest.doMock("../lib/teamStatProfiles", () => ({ getOrRefreshTeamProfile, getExistingTeamProfile }));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    {
      query: {
        matchId: "af-777", competitionCode: "af-235", homeTeamId: "af-10", awayTeamId: "af-11",
        homeTeamName: "Akron Tolyatti", awayTeamName: "Rubin Kazan",
      },
    },
    res
  );

  expect(getOrRefreshTeamProfile).toHaveBeenCalledTimes(2);
  expect(getOrRefreshTeamProfile).toHaveBeenCalledWith(
    expect.objectContaining({ teamName: "Akron Tolyatti", competitionCode: "af-235", apiFootballKey: AF_KEY })
  );
  expect(getExistingTeamProfile).not.toHaveBeenCalled();

  expect(res.body.available).toBe(true);
  expect(res.body.home.source).toBe("profil d'équipe (Bloc 1)");
  expect(res.body.away.source).toBe("profil d'équipe (Bloc 1)");
  // Analyse complète : probabilités, buts, corners, cartons — jamais un résultat vide.
  expect(res.body.probabilities).toBeDefined();
  expect(res.body.goals.expectedHome).toBeGreaterThan(0);
  expect(res.body.extraStats.corners.total).not.toBeNull();
  expect(res.body.markets.yellowCards.available).toBe(true);
});

test('match "af-" dont une équipe est introuvable côté API-Football : analyse dégradée mais cohérente (estimation moyenne), jamais un match vide ni une erreur', async () => {
  const getOrRefreshTeamProfile = jest.fn(({ teamName }) =>
    Promise.resolve(
      teamName === "Akron Tolyatti"
        ? { available: true, teamName, home: fullSplit(), away: fullSplit() }
        : { available: false, reason: "équipe introuvable côté API-Football" }
    )
  );
  jest.doMock("../lib/teamStatProfiles", () => ({ getOrRefreshTeamProfile, getExistingTeamProfile: jest.fn() }));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    {
      query: {
        matchId: "af-778", competitionCode: "af-235", homeTeamId: "af-10", awayTeamId: "af-99",
        homeTeamName: "Akron Tolyatti", awayTeamName: "Équipe Obscure FC",
      },
    },
    res
  );

  // Un seul profil disponible -> retombe entièrement sur l'ancien modèle (jamais un
  // mélange), lequel se rabat lui-même sur une estimation moyenne pour l'équipe sans
  // donnée réelle (NEUTRAL_ROW, voir lib/pronostic.js) — le résultat reste complet.
  expect(res.body.available).toBe(true);
  expect(res.body.probabilities).toBeDefined();
  expect(res.body.goals).toBeDefined();
  expect(res.body.correctScores?.length).toBeGreaterThan(0);
  expect(res.body.error).toBeUndefined();
});

test('match "af-" dont AUCUNE des deux équipes n\'a de profil calculable : reste malgré tout une analyse complète (jamais vide, jamais une page cassée)', async () => {
  const getOrRefreshTeamProfile = jest.fn(() =>
    Promise.resolve({ available: false, reason: "équipe introuvable côté API-Football" })
  );
  jest.doMock("../lib/teamStatProfiles", () => ({ getOrRefreshTeamProfile, getExistingTeamProfile: jest.fn() }));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    {
      query: {
        matchId: "af-779", competitionCode: "af-98", homeTeamId: "af-20", awayTeamId: "af-21",
        homeTeamName: "Petit Club A", awayTeamName: "Petit Club B",
      },
    },
    res
  );

  expect(res.body.available).toBe(true);
  expect(res.body.home.source).toBe("estimation moyenne");
  expect(res.body.away.source).toBe("estimation moyenne");
  expect(res.body.probabilities).toBeDefined();
  expect(res.body.correctScores?.length).toBeGreaterThan(0);
});

test('match football-data.org normal (pas "af-") : getOrRefreshTeamProfile n\'est JAMAIS appelé (quota API-Football préservé), getExistingTeamProfile (lecture) suffit', async () => {
  const getOrRefreshTeamProfile = jest.fn();
  const getExistingTeamProfile = jest.fn(() => Promise.resolve({ available: false, reason: "profil non calculé" }));
  jest.doMock("../lib/teamStatProfiles", () => ({ getOrRefreshTeamProfile, getExistingTeamProfile }));

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

  expect(getOrRefreshTeamProfile).not.toHaveBeenCalled();
  expect(getExistingTeamProfile).toHaveBeenCalledTimes(2);
  expect(res.body.available).toBe(true);
});
