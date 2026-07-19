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
    res.setHeader = jest.fn();
    return res;
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.FOOTBALL_DATA_TOKEN = TOKEN;
  });

  function mockFetchFor(matchState) {
    return jest.fn((url) => {
      // Endpoint distinct de l'état du match (voir lib/headToHead.js) : pas assez de
      // confrontations directes connues ici, volontairement neutre pour ces tests qui
      // portent sur le score/minute live, pas sur l'affinage par historique direct.
      if (url.includes("head2head")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      }
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
    // Le réseau Vercel doit pouvoir mutualiser cette réponse entre toutes les
    // instances (le cache en mémoire seul ne suffit pas sous charge concurrente).
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", expect.stringContaining("s-maxage"));
  });

  test("deux requêtes avec un score différent (avant/après un but) donnent des probabilités différentes", async () => {
    global.fetch = mockFetchFor({ status: "IN_PLAY", minute: 50, score: { fullTime: { home: 0, away: 0 } } });
    const { default: handlerBefore } = await import("../pages/api/analyze.js");
    const resBefore = mockRes();
    await handlerBefore(
      { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" } },
      resBefore
    );

    // Simule un nouveau cycle d'actualisation une fois le cache court (partagé entre
    // visiteurs) expiré : on repart d'un module frais, donc un nouvel appel en amont.
    jest.resetModules();
    process.env.FOOTBALL_DATA_TOKEN = TOKEN;
    global.fetch = mockFetchFor({ status: "IN_PLAY", minute: 51, score: { fullTime: { home: 1, away: 0 } } });
    const { default: handlerAfter } = await import("../pages/api/analyze.js");
    const resAfter = mockRes();
    await handlerAfter(
      { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" } },
      resAfter
    );

    expect(resAfter.body.probabilities.home).toBeGreaterThan(resBefore.body.probabilities.home);
    expect(resAfter.body.matchScore).toEqual({ home: 1, away: 0 });
  });

  test("deux requêtes rapprochées (dans la fenêtre de cache partagé) réutilisent le même appel en amont", async () => {
    const fetchMock = mockFetchFor({ status: "IN_PLAY", minute: 50, score: { fullTime: { home: 0, away: 0 } } });
    global.fetch = fetchMock;
    const { default: handler } = await import("../pages/api/analyze.js");

    await handler(
      { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" } },
      mockRes()
    );
    const callsAfterFirst = fetchMock.mock.calls.filter(([url]) => url.includes("/matches/777") && !url.includes("head2head")).length;

    await handler(
      { query: { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" } },
      mockRes()
    );
    const callsAfterSecond = fetchMock.mock.calls.filter(([url]) => url.includes("/matches/777") && !url.includes("head2head")).length;

    // Deux visiteurs (ou deux polls rapprochés) qui suivent le même match ne doivent
    // déclencher qu'un seul appel réel à l'API en amont, pas dépasser le quota.
    expect(callsAfterFirst).toBe(1);
    expect(callsAfterSecond).toBe(1);
  });

  test("plusieurs visiteurs qui suivent le même match au même instant ne déclenchent qu'un seul appel réel à l'API en amont", async () => {
    const fetchMock = mockFetchFor({ status: "IN_PLAY", minute: 50, score: { fullTime: { home: 0, away: 0 } } });
    global.fetch = fetchMock;
    const { default: handler } = await import("../pages/api/analyze.js");

    const query = { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "A", awayTeamName: "B" };
    await Promise.all(
      Array.from({ length: 5 }, () => handler({ query }, mockRes()))
    );

    const matchCalls = fetchMock.mock.calls.filter(([url]) => url.includes("/matches/777") && !url.includes("head2head")).length;
    expect(matchCalls).toBe(1);
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

describe("/api/analyze — événements live réels (API-Football), en complément de football-data.org", () => {
  const TOKEN = "test-token";
  const AF_KEY = "test-api-football-key";

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
    process.env.API_FOOTBALL_KEY = AF_KEY;
  });

  afterEach(() => {
    delete process.env.API_FOOTBALL_KEY;
  });

  const baseQuery = { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC" };

  function mockFetchWithApiFootball({ apiFootballFixtures, apiFootballEvents }) {
    return jest.fn((url) => {
      if (url.includes("head2head")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      }
      if (url.includes("/matches/777")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "IN_PLAY", minute: 23, score: { fullTime: { home: 1, away: 0 } } }) });
      }
      if (url.includes("/standings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      }
      if (url.includes("fixtures?live=all")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: apiFootballFixtures }) });
      }
      if (url.includes("fixtures/events")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: apiFootballEvents }) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
  }

  test("un but réel remonté par API-Football apparaît dans les événements du match, avec l'id football-data.org de l'équipe", async () => {
    global.fetch = mockFetchWithApiFootball({
      apiFootballFixtures: [
        { fixture: { id: 555 }, teams: { home: { id: 100, name: "Arsenal" }, away: { id: 101, name: "Chelsea" } } },
      ],
      apiFootballEvents: [
        { time: { elapsed: 23 }, team: { id: 100 }, player: { id: 1, name: "Bukayo Saka" }, type: "Goal", detail: "Normal Goal" },
      ],
    });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({ type: "GOAL", teamId: "10", minute: 23 });
  });

  test("match trouvé côté API-Football mais aucun événement pour l'instant : tableau vide, pas null", async () => {
    global.fetch = mockFetchWithApiFootball({
      apiFootballFixtures: [
        { fixture: { id: 555 }, teams: { home: { id: 100, name: "Arsenal" }, away: { id: 101, name: "Chelsea" } } },
      ],
      apiFootballEvents: [],
    });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.events).toEqual([]);
  });

  test("match introuvable côté API-Football (pas de correspondance de noms) : events reste null, jamais un match inventé", async () => {
    global.fetch = mockFetchWithApiFootball({
      apiFootballFixtures: [
        { fixture: { id: 555 }, teams: { home: { id: 100, name: "Real Madrid" }, away: { id: 101, name: "FC Barcelona" } } },
      ],
      apiFootballEvents: [],
    });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.events).toBeNull();
  });

  test("sans clé API_FOOTBALL_KEY configurée, events reste null (comportement inchangé, jamais d'erreur)", async () => {
    delete process.env.API_FOOTBALL_KEY;
    global.fetch = mockFetchWithApiFootball({ apiFootballFixtures: [], apiFootballEvents: [] });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.events).toBeNull();
    expect(res.body.live).toBe(true);
  });

  test("une erreur de l'API-Football (ex: quota dépassé) laisse events à null sans faire échouer toute la requête", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("head2head")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      }
      if (url.includes("/matches/777")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "IN_PLAY", minute: 23, score: { fullTime: { home: 1, away: 0 } } }) });
      }
      if (url.includes("/standings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      }
      if (url.includes("fixtures?live=all")) {
        return Promise.resolve({ ok: false, status: 429 });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.events).toBeNull();
    expect(res.body.probabilities).toBeDefined();
  });

  test("un match pas encore commencé n'appelle jamais API-Football (events null, aucun appel superflu)", async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes("/matches/777")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SCHEDULED", minute: null, score: { fullTime: { home: null, away: null } } }) });
      }
      if (url.includes("/standings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      }
      if (url.includes("head2head")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.events).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.includes("api-sports") || url.includes("fixtures"))).toBe(false);
  });
});
