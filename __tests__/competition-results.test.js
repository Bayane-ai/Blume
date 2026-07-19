/**
 * Vérifie le paramètre view=results de /api/competition-matches (onglet "Résultats"
 * de la page d'une compétition) : interroge les matchs FINISHED sur les 90 derniers
 * jours, triés du plus récent au plus ancien, sans toucher au comportement par
 * défaut (calendrier des matchs à venir).
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

function fixtureMatch(id, utcDate) {
  return {
    id, status: "FINISHED", utcDate,
    competition: { code: "PL", name: "Premier League" },
    homeTeam: { id: 10, name: "Arsenal FC" },
    awayTeam: { id: 11, name: "Chelsea FC" },
    score: { fullTime: { home: 2, away: 1 } },
  };
}

test("view=results interroge le statut FINISHED et trie du plus récent au plus ancien", async () => {
  let capturedUrl = "";
  global.fetch = jest.fn((url) => {
    if (url.includes("/matches?")) {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            matches: [
              fixtureMatch(1, "2026-07-01T12:00:00Z"),
              fixtureMatch(2, "2026-07-10T12:00:00Z"),
            ],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
  });

  const { default: handler } = await import("../pages/api/competition-matches.js");
  const res = mockRes();
  await handler({ query: { code: "PL", view: "results" } }, res);

  expect(capturedUrl).toContain("status=FINISHED");
  expect(res.body.matches.map((m) => m.id)).toEqual([2, 1]);
});

test("sans view (par défaut) : comportement calendrier inchangé, statut à venir", async () => {
  let capturedUrl = "";
  global.fetch = jest.fn((url) => {
    if (url.includes("/matches?")) {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
  });

  const { default: handler } = await import("../pages/api/competition-matches.js");
  const res = mockRes();
  await handler({ query: { code: "PL" } }, res);

  expect(capturedUrl).toContain("status=SCHEDULED,TIMED,LIVE,IN_PLAY,PAUSED");
});
