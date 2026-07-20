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

  test("un match pas encore commencé n'appelle jamais API-Football pour le fil d'événements live (events null, aucun appel superflu)", async () => {
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
      // "Joueurs susceptibles de prendre un carton" (lib/apiFootball.js) est lui bien
      // interrogé quel que soit le statut du match, comme les buteurs probables — pas
      // une donnée "live", donc pas concerné par cette assertion.
      if (url.includes("/teams?search=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.events).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.includes("fixtures"))).toBe(false);
  });

  test("bloc 2 — un match identifié par un id 'af-' (connu seulement d'API-Football) n'interroge jamais football-data.org pour son score, et suit son propre score/minute en direct", async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes("/standings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      }
      if (url.includes("fixtures?live=all")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: [{
              fixture: { id: 900, status: { short: "2H", elapsed: 71 }, venue: { name: "Maracanã" }, referee: "A. Ref" },
              league: { id: 71, name: "Brasileirão" },
              teams: { home: { id: 100, name: "Arsenal" }, away: { id: 101, name: "Chelsea" } },
              goals: { home: 3, away: 2 },
            }],
          }),
        });
      }
      if (url.includes("fixtures/events")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      }
      // Aucun appel à /matches/ ou /head2head de football-data.org ne devrait être fait
      // pour un id "af-" : si l'un d'eux est appelé, le test échoue ici.
      return Promise.reject(new Error(`Appel football-data.org inattendu pour un match af- : ${url}`));
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: { ...baseQuery, matchId: "af-900" } }, res);

    expect(res.body.live).toBe(true);
    expect(res.body.matchScore).toEqual({ home: 3, away: 2 });
    expect(res.body.matchMinute).toBe(71);
    expect(res.body.venue).toBe("Maracanã");
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/matches/af-900") || url.includes("head2head"))).toBe(false);
  });

  test("bloc 2 — un match hors des compétitions football-data.org (id numérique connu, mais absent de son flux live) retombe sur API-Football pour le score en direct", async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes("/matches/777")) {
        // football-data.org ne connaît pas (ou plus) ce match en direct.
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (url.includes("/standings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      }
      if (url.includes("head2head")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      }
      if (url.includes("fixtures?live=all")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: [{
              fixture: { id: 901, status: { short: "1H", elapsed: 20 } },
              league: { id: 5, name: "Some League" },
              teams: { home: { id: 100, name: "Arsenal" }, away: { id: 101, name: "Chelsea" } },
              goals: { home: 1, away: 0 },
            }],
          }),
        });
      }
      if (url.includes("fixtures/events")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.live).toBe(true);
    expect(res.body.matchScore).toEqual({ home: 1, away: 0 });
    expect(res.body.matchMinute).toBe(20);
  });
});

describe("/api/analyze — buteurs probables, filtrés sur les vrais joueurs de chaque équipe", () => {
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

  const baseQuery = { matchId: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC" };

  function mockFetchWithScorers(scorers) {
    return jest.fn((url) => {
      if (url.includes("head2head")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      }
      if (url.includes("/matches/777")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SCHEDULED", minute: null, score: { fullTime: { home: null, away: null } } }) });
      }
      if (url.includes("/standings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      }
      if (url.includes("/scorers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ scorers }) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
  }

  test("les buteurs probables renvoyés sont bien ceux des deux équipes du match, séparés, avec leurs vrais totaux", async () => {
    global.fetch = mockFetchWithScorers([
      { player: { id: 1, name: "Bukayo Saka" }, team: { id: 10 }, goals: 12, assists: 6 },
      { player: { id: 2, name: "Cole Palmer" }, team: { id: 11 }, goals: 15, assists: 9 },
      { player: { id: 3, name: "Joueur hors match" }, team: { id: 999 }, goals: 20, assists: 1 },
    ]);

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.probableScorers.home.scorers).toEqual([{ name: "Bukayo Saka", goals: 12 }]);
    expect(res.body.probableScorers.away.scorers).toEqual([{ name: "Cole Palmer", goals: 15 }]);
    // Le joueur d'une équipe hors de ce match n'apparaît nulle part.
    const allNames = JSON.stringify(res.body.probableScorers);
    expect(allNames).not.toContain("Joueur hors match");
  });

  test("interroge le bon endpoint /scorers avec le vrai code de compétition du match", async () => {
    const fetchMock = mockFetchWithScorers([]);
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/analyze.js");
    await handler({ query: baseQuery }, mockRes());

    expect(fetchMock.mock.calls.some(([url]) => url.includes("/competitions/PL/scorers"))).toBe(true);
  });

  test("aucune donnée de buteur disponible (échec de l'API) : listes vides, jamais un joueur inventé, et le reste du pronostic fonctionne quand même", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("head2head")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      if (url.includes("/matches/777")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SCHEDULED", minute: null, score: { fullTime: { home: null, away: null } } }) });
      if (url.includes("/standings")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      if (url.includes("/scorers")) return Promise.resolve({ ok: false, status: 429 });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.probableScorers).toEqual({
      home: { scorers: [], assists: [] },
      away: { scorers: [], assists: [] },
    });
    expect(res.body.probabilities).toBeDefined();
  });

  test("deux matchs différents (compétitions/équipes différentes) ont des buteurs probables différents", async () => {
    global.fetch = mockFetchWithScorers([
      { player: { id: 1, name: "Bukayo Saka" }, team: { id: 10 }, goals: 12, assists: 6 },
      { player: { id: 2, name: "Cole Palmer" }, team: { id: 11 }, goals: 15, assists: 9 },
    ]);
    const { default: handler } = await import("../pages/api/analyze.js");
    const res1 = mockRes();
    await handler({ query: baseQuery }, res1);

    jest.resetModules();
    process.env.FOOTBALL_DATA_TOKEN = TOKEN;
    global.fetch = mockFetchWithScorers([
      { player: { id: 3, name: "Vinícius Júnior" }, team: { id: 20 }, goals: 18, assists: 5 },
      { player: { id: 4, name: "Robert Lewandowski" }, team: { id: 21 }, goals: 22, assists: 3 },
    ]);
    const { default: handler2 } = await import("../pages/api/analyze.js");
    const res2 = mockRes();
    await handler2({
      query: { matchId: "778", competitionCode: "PD", homeTeamId: "20", awayTeamId: "21", homeTeamName: "Real Madrid", awayTeamName: "Barcelona" },
    }, res2);

    expect(JSON.stringify(res1.body.probableScorers)).not.toBe(JSON.stringify(res2.body.probableScorers));
  });
});

describe("/api/analyze — joueurs susceptibles de prendre un carton (best-effort, API-Football)", () => {
  const TOKEN = "test-token";
  const AF_KEY = "test-af-key";

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

  function mockFetchWithCardStats({ homeTeamId, homePlayers, awayTeamId, awayPlayers }) {
    return jest.fn((url) => {
      if (url.includes("head2head")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      if (url.includes("/matches/777")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SCHEDULED", minute: null, score: { fullTime: { home: null, away: null } } }) });
      if (url.includes("/standings")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      if (url.includes("/scorers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ scorers: [] }) });
      if (url.includes("/teams?search=")) {
        const q = decodeURIComponent(new URL(url).searchParams.get("search"));
        if (q === "Arsenal FC") return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: homeTeamId, name: "Arsenal" } }] }) });
        if (q === "Chelsea FC") return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: awayTeamId, name: "Chelsea" } }] }) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      }
      if (url.includes(`/players?team=${homeTeamId}`)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: homePlayers }) });
      if (url.includes(`/players?team=${awayTeamId}`)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: awayPlayers }) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
  }

  test("renvoie les vrais joueurs les plus sujets aux cartons de chaque équipe, séparés, jamais mélangés", async () => {
    global.fetch = mockFetchWithCardStats({
      homeTeamId: 100, awayTeamId: 101,
      homePlayers: [{ player: { name: "Declan Rice" }, statistics: [{ cards: { yellow: 5, red: 0 } }] }],
      awayPlayers: [{ player: { name: "Moises Caicedo" }, statistics: [{ cards: { yellow: 6, red: 1 } }] }],
    });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.cardProneness.home).toEqual([{ name: "Declan Rice", yellow: 5, red: 0 }]);
    expect(res.body.cardProneness.away).toEqual([{ name: "Moises Caicedo", yellow: 6, red: 1 }]);
  });

  test("sans clé API_FOOTBALL_KEY, cardProneness reste honnêtement vide (jamais un joueur inventé), sans casser le reste du pronostic", async () => {
    delete process.env.API_FOOTBALL_KEY;
    global.fetch = jest.fn((url) => {
      if (url.includes("head2head")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
      if (url.includes("/matches/777")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SCHEDULED", minute: null, score: { fullTime: { home: null, away: null } } }) });
      if (url.includes("/standings")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [homeRow, awayRow] }] }) });
      if (url.includes("/scorers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ scorers: [] }) });
      if (url.includes("api-sports") || url.includes("/teams?search=") || url.includes("/players?")) {
        throw new Error("Ne devrait jamais être appelé sans clé");
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.cardProneness).toEqual({ home: [], away: [] });
    expect(res.body.probabilities).toBeDefined();
  });

  test("équipe introuvable côté API-Football : liste vide pour cette équipe, jamais un plantage", async () => {
    global.fetch = mockFetchWithCardStats({
      homeTeamId: 100, awayTeamId: 101,
      homePlayers: [{ player: { name: "Declan Rice" }, statistics: [{ cards: { yellow: 5, red: 0 } }] }],
      awayPlayers: [],
    });
    // "Chelsea FC" ne sera volontairement pas trouvé : force une recherche vide pour l'extérieur.
    const fetchMock = jest.fn((url) => {
      if (url.includes("/teams?search=Chelsea")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      return mockFetchWithCardStats({
        homeTeamId: 100, awayTeamId: 101,
        homePlayers: [{ player: { name: "Declan Rice" }, statistics: [{ cards: { yellow: 5, red: 0 } }] }],
        awayPlayers: [],
      })(url);
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/analyze.js");
    const res = mockRes();
    await handler({ query: baseQuery }, res);

    expect(res.body.cardProneness.home).toEqual([{ name: "Declan Rice", yellow: 5, red: 0 }]);
    expect(res.body.cardProneness.away).toEqual([]);
  });
});
