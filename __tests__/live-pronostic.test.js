/**
 * Vérifie que les pronostics d'un match EN COURS sont recalculés à partir du score
 * réel et de la minute de jeu (pas seulement les probabilités pré-match figées), et
 * que /api/analyze relit systématiquement l'état du match depuis l'API (jamais de
 * valeur mise en cache ou transmise par le client sans vérification).
 */
import { computePronostic, computeLivePronostic } from "../lib/pronostic";

const homeRow = { position: 3, points: 55, form: "WWDLW", playedGames: 20, goalsFor: 40, goalsAgainst: 20, team: { id: 10 } };
const awayRow = { position: 7, points: 44, form: "LWDDW", playedGames: 20, goalsFor: 28, goalsAgainst: 26, team: { id: 11 } };

describe("computeLivePronostic — les probabilités suivent le score réel", () => {
  test("à 0-0 en début de match, les probabilités restent proches du pronostic pré-match", () => {
    const prematch = computePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B" });
    const live = computeLivePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B", currentHome: 0, currentAway: 0, minute: 1 });
    expect(live.available).toBe(true);
    expect(live.live).toBe(true);
    expect(Math.abs(live.probabilities.home - prematch.probabilities.home)).toBeLessThan(5);
  });

  test("l'équipe qui mène largement voit sa probabilité de victoire nettement augmenter", () => {
    const level = computeLivePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B", currentHome: 0, currentAway: 0, minute: 60 });
    const leading = computeLivePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B", currentHome: 3, currentAway: 0, minute: 60 });
    expect(leading.probabilities.home).toBeGreaterThan(level.probabilities.home);
    expect(leading.probabilities.away).toBeLessThan(level.probabilities.away);
  });

  test("changer le score change bien les probabilités (jamais figées au pré-match)", () => {
    const scoreA = computeLivePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B", currentHome: 1, currentAway: 0, minute: 70 });
    const scoreB = computeLivePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B", currentHome: 1, currentAway: 2, minute: 70 });
    expect(scoreA.probabilities.home).not.toBeCloseTo(scoreB.probabilities.home, 1);
    expect(scoreA.probabilities.away).not.toBeCloseTo(scoreB.probabilities.away, 1);
  });

  test("en fin de match, le score actuel détermine quasi entièrement le résultat (plus de temps pour changer)", () => {
    const live = computeLivePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B", currentHome: 2, currentAway: 0, minute: 90 });
    expect(live.probabilities.home).toBeGreaterThan(90);
    expect(live.correctScores[0].score).toBe("2-0");
  });

  test("les buts attendus (score final estimé) intègrent le score déjà marqué", () => {
    const live = computeLivePronostic({ homeRow, awayRow, homeTeamName: "A", awayTeamName: "B", currentHome: 2, currentAway: 1, minute: 80 });
    expect(live.goals.expectedHome).toBeGreaterThanOrEqual(2);
    expect(live.goals.expectedAway).toBeGreaterThanOrEqual(1);
  });
});

describe("/api/analyze — relit toujours l'état du match depuis l'API pour un match en direct", () => {
  const TOKEN = "test-token";

  function mockRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.FOOTBALL_DATA_TOKEN = TOKEN;
  });

  function mockFetchFor(matchState) {
    return jest.fn((url) => {
      if (url.includes("/matches/777")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(matchState) });
      }
      if (url.includes("/standings")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }),
        });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
  }

  test("un match IN_PLAY renvoie un pronostic live basé sur le score/minute lus à l'instant de la requête", async () => {
    global.fetch = mockFetchFor({ status: "IN_PLAY", minute: 63, score: { fullTime: { home: 2, away: 0 } } });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" } },
      res
    );

    expect(res.body.live).toBe(true);
    expect(res.body.matchScore).toEqual({ home: 2, away: 0 });
    expect(res.body.matchMinute).toBe(63);
    expect(res.body.probabilities.home).toBeGreaterThan(50);
  });

  test("deux requêtes avec un score différent (avant/après un but) donnent des probabilités différentes", async () => {
    const { default: handler } = await import("../pages/api/analyze.js");

    global.fetch = mockFetchFor({ status: "IN_PLAY", minute: 50, score: { fullTime: { home: 0, away: 0 } } });
    const resBefore = mockRes();
    await handler(
      { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" } },
      resBefore
    );

    global.fetch = mockFetchFor({ status: "IN_PLAY", minute: 51, score: { fullTime: { home: 1, away: 0 } } });
    const resAfter = mockRes();
    await handler(
      { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" } },
      resAfter
    );

    expect(resAfter.body.probabilities.home).toBeGreaterThan(resBefore.body.probabilities.home);
    expect(resAfter.body.matchScore).toEqual({ home: 1, away: 0 });
  });

  test("un match terminé ou pas encore commencé n'utilise pas le mode live", async () => {
    global.fetch = mockFetchFor({ status: "SCHEDULED", minute: null, score: { fullTime: { home: null, away: null } } });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler(
      { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" } },
      res
    );

    expect(res.body.live).toBe(false);
  });
});
