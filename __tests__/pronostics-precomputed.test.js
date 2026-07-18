/**
 * Vérifie que les pronostics sont déjà calculés au chargement de la page,
 * pour tout match (en ligne, à venir demain, ou dans la semaine),
 * sans attendre une action de l'utilisateur (aucun clic déclencheur).
 */

const TOKEN = "test-token";
const HOUR = 3600000;
const DAY = 24 * HOUR;

function makeMatch({ id, status, utcDate, homeId, awayId, homeName, awayName, competitionCode }) {
  return {
    id,
    status,
    utcDate,
    competition: { code: competitionCode },
    homeTeam: { id: homeId, name: homeName, crest: "" },
    awayTeam: { id: awayId, name: awayName, crest: "" },
    score: { fullTime: { home: null, away: null } },
  };
}

function standingsResponse(rows) {
  return { standings: [{ table: rows }] };
}

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn();
  return res;
}

describe("Pronostics précalculés (pas de clic nécessaire)", () => {
  const now = Date.now();

  const plTable = [
    { position: 1, points: 25, form: "WWWWW", playedGames: 10, goalsFor: 20, goalsAgainst: 10, team: { id: 100 } },
    { position: 5, points: 18, form: "WDLWD", playedGames: 10, goalsFor: 15, goalsAgainst: 12, team: { id: 101 } },
  ];

  beforeEach(() => {
    jest.resetModules();
    process.env.FOOTBALL_DATA_TOKEN = TOKEN;

    global.fetch = jest.fn((url) => {
      if (url.includes("/v4/matches?")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              matches: [
                // Match en ligne (en cours ce soir).
                makeMatch({
                  id: 1, status: "IN_PLAY", utcDate: new Date(now).toISOString(),
                  homeId: 100, awayId: 101, homeName: "Arsenal FC", awayName: "Chelsea FC", competitionCode: "PL",
                }),
                // Match à venir demain.
                makeMatch({
                  id: 2, status: "SCHEDULED", utcDate: new Date(now + DAY).toISOString(),
                  homeId: 100, awayId: 101, homeName: "Arsenal FC", awayName: "Chelsea FC", competitionCode: "PL",
                }),
                // Match à venir dans la semaine (jour 6).
                makeMatch({
                  id: 3, status: "SCHEDULED", utcDate: new Date(now + 6 * DAY).toISOString(),
                  homeId: 100, awayId: 101, homeName: "Arsenal FC", awayName: "Chelsea FC", competitionCode: "PL",
                }),
              ],
            }),
        });
      }
      if (url.includes("/standings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(standingsResponse(plTable)) });
      }
      return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
    });
  });

  test("un seul chargement de /api/matches renvoie déjà le pronostic de chaque match (en ligne, demain, dans la semaine)", async () => {
    const { default: handler } = await import("../pages/api/matches.js");
    const res = mockRes();

    await handler({}, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.body;
    expect(body.error).toBeUndefined();

    const pl = body.competitions.find((c) => c.code === "PL");
    expect(pl.matches).toHaveLength(3);

    // Aucun clic n'a eu lieu : cette seule réponse doit déjà contenir un pronostic exploitable
    // pour les trois matchs (en ligne, demain, dans la semaine).
    for (const m of pl.matches) {
      expect(m.pronostic).toBeDefined();
      expect(m.pronostic.available).toBe(true);
      expect(typeof m.pronostic.probabilities.home).toBe("number");
      expect(typeof m.pronostic.probabilities.draw).toBe("number");
      expect(typeof m.pronostic.probabilities.away).toBe("number");
      expect(m.pronostic.goals).toEqual(
        expect.objectContaining({
          expectedHome: expect.any(Number),
          expectedAway: expect.any(Number),
          over25: expect.any(Number),
          bttsYes: expect.any(Number),
        })
      );
      expect(m.pronostic.correctScores.length).toBeGreaterThanOrEqual(3);
    }

    // Le classement de la compétition n'a été demandé qu'une seule fois pour les trois
    // matchs (mis en cache), pas une fois par match.
    const standingsCalls = global.fetch.mock.calls.filter(([url]) => url.includes("/standings"));
    expect(standingsCalls).toHaveLength(1);
  });

  test("/api/competition-matches renvoie aussi les pronostics déjà calculés, sans clic supplémentaire", async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes("/matches?")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              matches: [
                makeMatch({
                  id: 10, status: "SCHEDULED", utcDate: new Date(now + 2 * DAY).toISOString(),
                  homeId: 100, awayId: 101, homeName: "Arsenal FC", awayName: "Chelsea FC", competitionCode: "PL",
                }),
              ],
            }),
        });
      }
      if (url.includes("/standings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(standingsResponse(plTable)) });
      }
      return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
    });

    const { default: handler } = await import("../pages/api/competition-matches.js");
    const res = mockRes();

    await handler({ query: { code: "PL" } }, res);

    const body = res.body;
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].pronostic.available).toBe(true);
    expect(body.matches[0].pronostic.probabilities.home).toEqual(expect.any(Number));
  });
});
