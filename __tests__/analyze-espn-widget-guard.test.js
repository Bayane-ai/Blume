/**
 * pages/api/analyze.js — un match affiché par components/ExternalMatchesWidget.js (id
 * préfixé "espn-", voir lib/espnSoccer.js) ne doit JAMAIS être envoyé à
 * football-data.org (ses ids sont numérotés indépendamment, gaspillerait le quota pour
 * une requête vouée à échouer) — réponse honnête à la place, même garde-fou que pour
 * un match basket ("bk-", voir __tests__/analyze-basketball-guard.test.js).
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

test("un matchId « espn-… » renvoie honnêtement indisponible, sans appeler football-data.org", async () => {
  process.env.FOOTBALL_DATA_TOKEN = "test-token";
  global.fetch = jest.fn(() => Promise.reject(new Error("Aucun appel réseau attendu pour un match du widget externe")));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    {
      query: {
        matchId: "espn-uefa.champions-401598010", competitionCode: "espn-uefa.champions",
        homeTeamId: "espn-team-111", awayTeamId: "espn-team-222",
        homeTeamName: "Real Madrid", awayTeamName: "Manchester City",
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

test("fonctionne même sans FOOTBALL_DATA_TOKEN configuré", async () => {
  delete process.env.FOOTBALL_DATA_TOKEN;
  global.fetch = jest.fn(() => Promise.reject(new Error("Aucun appel réseau attendu")));

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler({ query: { matchId: "espn-rus.1-1", competitionCode: "espn-rus.1", homeTeamId: "espn-team-1", awayTeamId: "espn-team-2" } }, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body.available).toBe(false);
});
