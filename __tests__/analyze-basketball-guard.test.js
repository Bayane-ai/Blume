/**
 * pages/api/analyze.js — multi-sport bloc 2 : un match basket (id préfixé "bk-", voir
 * lib/sports/basketball/mapper.js) ne doit JAMAIS être envoyé à football-data.org, et
 * ne doit jamais recevoir un pronostic football calculé à tort — réponse honnête
 * ("pas encore disponible") tant que le bloc 3 (pronostics basket) n'est pas fait.
 */
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.resetModules();
});

test("un matchId « bk-… » renvoie honnêtement indisponible, sans appeler football-data.org", async () => {
  process.env.FOOTBALL_DATA_TOKEN = "test-token";
  global.fetch = jest.fn(() => Promise.reject(new Error("Aucun appel réseau attendu pour un match basket")));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    {
      query: {
        matchId: "bk-12345", competitionCode: "bk-12", homeTeamId: "bk-10", awayTeamId: "bk-11",
        homeTeamName: "Lakers", awayTeamName: "Warriors",
      },
    },
    res
  );

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body.available).toBe(false);
  expect(typeof res.body.message).toBe("string");
  expect(res.body.message.length).toBeGreaterThan(0);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("fonctionne même sans FOOTBALL_DATA_TOKEN configuré (le garde-fou basket passe avant la vérification de clé football)", async () => {
  delete process.env.FOOTBALL_DATA_TOKEN;
  global.fetch = jest.fn(() => Promise.reject(new Error("Aucun appel réseau attendu")));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler({ query: { matchId: "bk-1", competitionCode: "bk-1", homeTeamId: "bk-1", awayTeamId: "bk-2" } }, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body.available).toBe(false);
});

test("un match football (jamais préfixé bk-) continue de fonctionner exactement comme avant", async () => {
  process.env.FOOTBALL_DATA_TOKEN = "test-token";
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC" } },
    res
  );

  // Le garde-fou basket ne s'applique pas ici : le vrai chemin football (avec ses
  // propres erreurs/replis) reste emprunté, jamais court-circuité.
  expect(res.body.available).not.toBe(false);
  expect(global.fetch).toHaveBeenCalled();
});
