/**
 * Vérifie /api/compare (moteur de la page "Analyse IA") : calcule un pronostic entre
 * deux équipes choisies librement, à partir de leurs vraies statistiques — sans
 * dépendre d'un match précis programmé.
 */
const TOKEN = "test-token";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
});

function standingsFetch() {
  return jest.fn((url) => {
    if (url.includes("/standings")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            standings: [{
              table: [
                { position: 1, points: 70, form: "WWWWW", playedGames: 20, goalsFor: 60, goalsAgainst: 15, team: { id: 10, name: "Real Madrid" } },
                { position: 2, points: 60, form: "WWDLW", playedGames: 20, goalsFor: 50, goalsAgainst: 20, team: { id: 11, name: "Barcelona" } },
              ],
            }],
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

test("calcule un vrai pronostic entre deux équipes choisies librement", async () => {
  global.fetch = standingsFetch();

  const { default: handler } = await import("../pages/api/compare.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "PD", homeTeamId: "10", awayTeamId: "11", homeTeamName: "Real Madrid", awayTeamName: "Barcelona" } },
    res
  );

  expect(res.body.available).toBe(true);
  expect(res.body.live).toBe(false);
  expect(typeof res.body.probabilities.home).toBe("number");
  expect(res.body.correctScores.length).toBeGreaterThanOrEqual(3);
  expect(res.body.extraStats).toBeDefined();
});

test("refuse deux fois la même équipe", async () => {
  global.fetch = standingsFetch();
  const { default: handler } = await import("../pages/api/compare.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "PD", homeTeamId: "10", awayTeamId: "10", homeTeamName: "Real Madrid", awayTeamName: "Real Madrid" } },
    res
  );
  expect(res.status).toHaveBeenCalledWith(400);
});

test("paramètres manquants : erreur claire", async () => {
  const { default: handler } = await import("../pages/api/compare.js");
  const res = mockRes();
  await handler({ query: { competitionCode: "PD" } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});
