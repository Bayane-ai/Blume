/**
 * Vérifie que /api/analyze donne toujours un pronostic exploitable, même quand une
 * équipe est absente du classement de la compétition (ex : Coupe du Monde à plusieurs
 * groupes, phase à élimination directe) — en se rabattant sur la forme récente réelle
 * de l'équipe, puis sur une estimation moyenne en dernier recours.
 */

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

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
});

test("le classement à plusieurs groupes (ex : Coupe du Monde) est bien fusionné : une équipe du 2e groupe est trouvée", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            standings: [
              { type: "TOTAL", group: "GROUP_A", table: [{ position: 1, points: 7, form: null, playedGames: 3, goalsFor: 5, goalsAgainst: 1, team: { id: 100 } }] },
              { type: "TOTAL", group: "GROUP_B", table: [{ position: 1, points: 9, form: null, playedGames: 3, goalsFor: 6, goalsAgainst: 0, team: { id: 200 } }] },
            ],
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "WC", homeTeamId: "100", awayTeamId: "200", homeTeamName: "France", awayTeamName: "Angleterre" } },
    res
  );

  expect(res.body.available).toBe(true);
  expect(res.body.home.source).toBe("classement");
  expect(res.body.away.source).toBe("classement");
  expect(typeof res.body.probabilities.home).toBe("number");
});

test("une équipe absente du classement bascule sur ses derniers matchs joués, et le pronostic reste disponible", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            standings: [
              { table: [{ position: 1, points: 7, form: null, playedGames: 3, goalsFor: 5, goalsAgainst: 1, team: { id: 100 } }] },
            ],
          }),
      });
    }
    if (url.includes("/teams/200/matches")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            matches: [
              { homeTeam: { id: 200 }, awayTeam: { id: 999 }, score: { fullTime: { home: 2, away: 1 } } },
              { homeTeam: { id: 888 }, awayTeam: { id: 200 }, score: { fullTime: { home: 0, away: 3 } } },
            ],
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "CL", homeTeamId: "100", awayTeamId: "200", homeTeamName: "Équipe A", awayTeamName: "Équipe B" } },
    res
  );

  expect(res.body.available).toBe(true);
  expect(res.body.home.source).toBe("classement");
  expect(res.body.away.source).toBe("forme récente");
  expect(res.body.probabilities.home).toEqual(expect.any(Number));
  expect(res.body.correctScores.length).toBeGreaterThanOrEqual(3);
});

test("aucune donnée disponible pour aucune des deux équipes : le pronostic est quand même renvoyé (estimation moyenne)", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    }
    if (url.includes("/teams/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "WC", homeTeamId: "1", awayTeamId: "2", homeTeamName: "Équipe A", awayTeamName: "Équipe B" } },
    res
  );

  expect(res.body.available).toBe(true);
  expect(res.body.home.source).toBe("estimation moyenne");
  expect(res.body.away.source).toBe("estimation moyenne");
  expect(res.body.probabilities.home).toEqual(expect.any(Number));
  expect(res.body.probabilities.draw).toEqual(expect.any(Number));
  expect(res.body.probabilities.away).toEqual(expect.any(Number));
  expect(res.body.correctScores.length).toBeGreaterThanOrEqual(3);
});
