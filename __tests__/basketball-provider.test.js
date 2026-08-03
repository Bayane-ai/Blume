/**
 * lib/sports/basketball/provider.js — bloc 1 (API basket) : API-SPORTS Basketball
 * (v1.basketball.api-sports.io, même fournisseur/compte que le football), cache court
 * pour le direct (30-60s), cache plus long pour les données de saison, pause après un
 * 429 (quota quotidien), et repli honnête (jamais une liste vide masquant une vraie
 * panne) — même conventions que lib/apiFootball.js déjà en place pour le football.
 */
const KEY = "test-basketball-key";

beforeEach(() => {
  jest.resetModules();
  delete process.env.API_FOOTBALL_KEY;
  delete process.env.API_BASKETBALL_KEY;
});

describe("getBasketballApiKey — réutilise la clé football par défaut, API_BASKETBALL_KEY prend le pas si définie", () => {
  test("aucune clé définie : null", async () => {
    const { getBasketballApiKey } = await import("../lib/sports/basketball/provider.js");
    expect(getBasketballApiKey()).toBeNull();
  });

  test("seule API_FOOTBALL_KEY est définie : réutilisée pour le basket", async () => {
    process.env.API_FOOTBALL_KEY = "shared-key";
    const { getBasketballApiKey } = await import("../lib/sports/basketball/provider.js");
    expect(getBasketballApiKey()).toBe("shared-key");
  });

  test("API_BASKETBALL_KEY définie : prioritaire sur API_FOOTBALL_KEY", async () => {
    process.env.API_FOOTBALL_KEY = "shared-key";
    process.env.API_BASKETBALL_KEY = "dedicated-key";
    const { getBasketballApiKey } = await import("../lib/sports/basketball/provider.js");
    expect(getBasketballApiKey()).toBe("dedicated-key");
  });
});

describe("getLiveGames — TOUS les matchs en direct dans le monde, sans filtre de compétition", () => {
  test("sans clé, renvoie une liste vide sans jamais appeler l'API", async () => {
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    global.fetch = jest.fn();
    expect(await getLiveGames(null)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("appelle /games?live=all avec le bon header d'authentification, sans aucun filtre de ligue/pays", async () => {
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }] }) }));
    global.fetch = fetchMock;

    const games = await getLiveGames(KEY);
    expect(games).toEqual([{ id: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.basketball.api-sports.io/games?live=all");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "x-apisports-key": KEY });
  });

  test("plusieurs appels rapprochés ne déclenchent qu'un seul appel réel (cache court, 30-60s)", async () => {
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    global.fetch = fetchMock;

    await Promise.all([getLiveGames(KEY), getLiveGames(KEY), getLiveGames(KEY)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("le cache expire bien après sa fenêtre (nouvel appel réel après 10min+)", async () => {
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    global.fetch = fetchMock;

    await getLiveGames(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
    await getLiveGames(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getGamesByDate — matchs (tous statuts) d'une date précise, toutes compétitions confondues", () => {
  test("sans clé ni date, renvoie une liste vide sans appeler l'API", async () => {
    const { getGamesByDate } = await import("../lib/sports/basketball/provider.js");
    global.fetch = jest.fn();
    expect(await getGamesByDate("2026-08-01", null)).toEqual([]);
    expect(await getGamesByDate(null, KEY)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("appelle /games?date=YYYY-MM-DD", async () => {
    const { getGamesByDate } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 2 }] }) }));
    global.fetch = fetchMock;

    const games = await getGamesByDate("2026-08-01", KEY);
    expect(games).toEqual([{ id: 2 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.basketball.api-sports.io/games?date=2026-08-01&timezone=UTC");
  });

  test("deux dates différentes sont mises en cache séparément (pas de collision)", async () => {
    const { getGamesByDate } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn((url) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ url }] }) })
    );
    global.fetch = fetchMock;

    const a = await getGamesByDate("2026-08-01", KEY);
    const b = await getGamesByDate("2026-08-02", KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a).not.toEqual(b);
  });
});

describe("getStandings / getTeamStatistics / getPlayerStatistics / getLeagues", () => {
  test("chaque fonction exige ses paramètres et la clé, sinon repli honnête sans appel réseau", async () => {
    const provider = await import("../lib/sports/basketball/provider.js");
    global.fetch = jest.fn();

    expect(await provider.getStandings({ league: null, season: "2025" }, KEY)).toEqual([]);
    expect(await provider.getTeamStatistics({ league: 12, season: "2025", team: null }, KEY)).toBeNull();
    expect(await provider.getPlayerStatistics({ id: null, season: "2025" }, KEY)).toEqual([]);
    expect(await provider.getLeagues(null)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("getStandings appelle /standings?league=X&season=Y", async () => {
    const { getStandings } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ position: 1 }] }) }));
    global.fetch = fetchMock;

    const table = await getStandings({ league: 12, season: "2025-2026" }, KEY);
    expect(table).toEqual([{ position: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.basketball.api-sports.io/standings?league=12&season=2025-2026");
  });

  test("getTeamStatistics appelle /teams/statistics?league=X&season=Y&team=Z et déballe l'objet unique", async () => {
    const { getTeamStatistics } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 5 } }] }) })
    );
    global.fetch = fetchMock;

    const stats = await getTeamStatistics({ league: 12, season: "2025-2026", team: 5 }, KEY);
    expect(stats).toEqual({ team: { id: 5 } });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://v1.basketball.api-sports.io/teams/statistics?league=12&season=2025-2026&team=5"
    );
  });

  test("getPlayerStatistics appelle /players/statistics?id=X&season=Y", async () => {
    const { getPlayerStatistics } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ points: 20 }] }) }));
    global.fetch = fetchMock;

    const stats = await getPlayerStatistics({ id: 99, season: "2025-2026" }, KEY);
    expect(stats).toEqual([{ points: 20 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.basketball.api-sports.io/players/statistics?id=99&season=2025-2026");
  });

  test("getLeagues n'ajoute AUCUN filtre — toutes les compétitions disponibles, sans exception", async () => {
    const { getLeagues } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }, { id: 2 }] }) }));
    global.fetch = fetchMock;

    const leagues = await getLeagues(KEY);
    expect(leagues).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.basketball.api-sports.io/leagues");
  });
});

describe("getGameStatistics — statistiques d'équipe pour un match précis", () => {
  test("sans id de match, repli honnête sans appel réseau", async () => {
    const { getGameStatistics } = await import("../lib/sports/basketball/provider.js");
    global.fetch = jest.fn();
    expect(await getGameStatistics(null, KEY)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("appelle /games/statistics?id=X", async () => {
    const { getGameStatistics } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: {} }] }) }));
    global.fetch = fetchMock;

    const stats = await getGameStatistics(555, KEY);
    expect(stats).toEqual([{ team: {} }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.basketball.api-sports.io/games/statistics?id=555");
  });
});

describe("Pause après un 429 (quota quotidien dépassé) — même mécanique que lib/apiFootball.js", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("après un 429 (sans aucune donnée connue avant), l'erreur remonte — puis la pause empêche tout nouvel appel réseau", async () => {
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));
    global.fetch = fetchMock;

    // Première fois, aucune donnée connue : l'erreur remonte (voir la route API, qui
    // la traduit en message clair côté interface — jamais une liste vide silencieuse
    // pour la SEULE source du basket).
    await expect(getLiveGames(KEY)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Nouvelle fenêtre de cache (le live expire vite), mais toujours en pause quota :
    // aucun nouvel appel réseau ne doit partir (même erreur immédiate, sans réseau).
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 50000);
    await expect(getLiveGames(KEY)).rejects.toThrow(/pause/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("une fois la pause (~1h) écoulée, un nouvel appel réel est retenté et peut réussir", async () => {
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    let call = 0;
    const fetchMock = jest.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: false, status: 429 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 7 }] }) });
    });
    global.fetch = fetchMock;

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    await expect(getLiveGames(KEY)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1_000_000 + 60 * 60 * 1000 + 1000);
    const games = await getLiveGames(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(games).toEqual([{ id: 7 }]);
  });
});

describe("Repli honnête sur la dernière donnée connue, jamais une donnée inventée", () => {
  test("un incident passager (erreur réseau) après un premier succès retombe sur la dernière valeur connue", async () => {
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    let call = 0;
    const fetchMock = jest.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }] }) });
      return Promise.reject(new Error("network down"));
    });
    global.fetch = fetchMock;

    const first = await getLiveGames(KEY);
    expect(first).toEqual([{ id: 1 }]);

    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 50000);
    const second = await getLiveGames(KEY);
    expect(second).toEqual([{ id: 1 }]); // repli sur la dernière valeur connue, pas un plantage
  });

  test("un échec sans AUCUNE donnée connue laisse l'erreur remonter (jamais masquée par une liste vide silencieuse)", async () => {
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    global.fetch = jest.fn(() => Promise.reject(new Error("network down")));
    await expect(getLiveGames(KEY)).rejects.toThrow("network down");
  });
});

describe("Cache intelligent du direct (PROMPT : rafraîchi toutes les 10 min, et SEULEMENT s'il existe un match plausible en cours/imminent)", () => {
  test("aucune donnée 'à venir' en cache connue (jamais vu) : tente quand même l'appel réel (fail open)", async () => {
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn(() => Promise.resolve(null)),
      writePersistentCache: jest.fn(),
    }));
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }] }) }));
    global.fetch = fetchMock;

    const games = await getLiveGames(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(games).toEqual([{ id: 1 }]);
  });

  test("des matchs à venir sont en cache mais AUCUN n'est en cours ni dans l'heure : zéro appel réel, sert le cache", async () => {
    const now = Date.now();
    const farAwayGame = { date: new Date(now + 6 * 3600000).toISOString() }; // dans 6h : hors fenêtre
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn((key) => {
        if (key === "basketball:live_all") return Promise.resolve({ payload: [], fetchedAt: now - 20 * 60 * 1000 });
        if (key.startsWith("basketball:upcoming:")) return Promise.resolve({ payload: [farAwayGame], fetchedAt: now });
        return Promise.resolve(null);
      }),
      writePersistentCache: jest.fn(),
    }));
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const games = await getLiveGames(KEY);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(games).toEqual([]); // sert le cache live connu (ici vide), jamais une erreur
  });

  test("un match à venir démarre dans l'heure : l'appel réel est bien tenté", async () => {
    const now = Date.now();
    const soonGame = { date: new Date(now + 30 * 60 * 1000).toISOString() }; // dans 30 min
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn((key) => {
        if (key.startsWith("basketball:upcoming:")) return Promise.resolve({ payload: [soonGame], fetchedAt: now });
        return Promise.resolve(null);
      }),
      writePersistentCache: jest.fn(),
    }));
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 2 }] }) }));
    global.fetch = fetchMock;

    const games = await getLiveGames(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(games).toEqual([{ id: 2 }]);
  });

  test("une instance froide (cache mémoire vide) réutilise le cache persisté encore frais, sans appel réel", async () => {
    const now = Date.now();
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn((key) =>
        key === "basketball:live_all" ? Promise.resolve({ payload: [{ id: 9 }], fetchedAt: now - 60 * 1000 }) : Promise.resolve(null)
      ),
      writePersistentCache: jest.fn(),
    }));
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const games = await getLiveGames(KEY);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(games).toEqual([{ id: 9 }]);
  });
});
