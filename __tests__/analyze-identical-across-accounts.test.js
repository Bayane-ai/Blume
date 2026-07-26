/**
 * pages/api/analyze.js — voir PROMPT (partie 1A) : "deux personnes différentes, sur
 * deux appareils différents, doivent voir exactement le même contenu" pour les
 * analyses/pronostics d'un match. Le handler ne lit JAMAIS req.cookies ni aucune
 * session (vérifié aussi statiquement : aucune occurrence de "session"/"profile_id"
 * dans pages/api/analyze.js) — le résultat ne dépend que des paramètres du match
 * (competitionCode, homeTeamId, awayTeamId...) et de caches PARTAGÉS entre tous les
 * visiteurs (lib/standingsCache.js, lib/teamForm.js...), jamais d'un identifiant de
 * compte ou d'appareil.
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
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn();
  return res;
}

function mockFetch() {
  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            standings: [
              {
                type: "TOTAL",
                table: [
                  { position: 3, points: 55, form: "WWDLW", playedGames: 20, goalsFor: 40, goalsAgainst: 20, team: { id: 10 } },
                  { position: 7, points: 44, form: "LWDDW", playedGames: 20, goalsFor: 28, goalsAgainst: 26, team: { id: 11 } },
                ],
              },
            ],
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue dans ce test : ${url}`));
  });
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
  mockFetch();
});

test("deux comptes différents (deux sessions/cookies distincts) qui consultent le MÊME match reçoivent une réponse strictement identique", async () => {
  const { default: handler } = await import("../pages/api/analyze.js");

  const query = { competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC" };

  // Compte A : requête portant le cookie de session d'Alice.
  const resA = mockRes();
  await handler({ query, cookies: { blume_session: "jeton-signe-de-alice" }, headers: {} }, resA);

  // Compte B : requête portant le cookie de session (différent) de Bob, MÊME match.
  const resB = mockRes();
  await handler({ query, cookies: { blume_session: "jeton-signe-de-bob" }, headers: {} }, resB);

  expect(resA.body.available).not.toBe(false);
  expect(resA.body).toEqual(resB.body);
});

test("un visiteur SANS AUCUN cookie de session (req.cookies absent) obtient le même résultat qu'un visiteur connecté", async () => {
  const { default: handler } = await import("../pages/api/analyze.js");

  const query = { competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC" };

  const resWithSession = mockRes();
  await handler({ query, cookies: { blume_session: "jeton-signe-de-alice" }, headers: {} }, resWithSession);

  const resWithoutSession = mockRes();
  await handler({ query, headers: {} }, resWithoutSession);

  expect(resWithSession.body).toEqual(resWithoutSession.body);
});
