/**
 * lib/sports/tennis/provider.js — bloc 5 (API tennis) : API-SPORTS Tennis
 * (v1.tennis.api-sports.io, même fournisseur/compte que le football/basket), cache
 * court pour le direct (15-30s), cache plus long pour les données de saison, pause
 * après un 429 (quota quotidien), et repli honnête (jamais une liste vide masquant
 * une vraie panne) — mêmes conventions que lib/sports/basketball/provider.js.
 */
const KEY = "test-tennis-key";

beforeEach(() => {
  jest.resetModules();
  delete process.env.API_FOOTBALL_KEY;
  delete process.env.API_TENNIS_KEY;
});

describe("getTennisApiKey — réutilise la clé football par défaut, API_TENNIS_KEY prend le pas si définie", () => {
  test("aucune clé définie : null", async () => {
    const { getTennisApiKey } = await import("../lib/sports/tennis/provider.js");
    expect(getTennisApiKey()).toBeNull();
  });

  test("seule API_FOOTBALL_KEY est définie : réutilisée pour le tennis", async () => {
    process.env.API_FOOTBALL_KEY = "shared-key";
    const { getTennisApiKey } = await import("../lib/sports/tennis/provider.js");
    expect(getTennisApiKey()).toBe("shared-key");
  });

  test("API_TENNIS_KEY définie : prioritaire sur API_FOOTBALL_KEY", async () => {
    process.env.API_FOOTBALL_KEY = "shared-key";
    process.env.API_TENNIS_KEY = "dedicated-key";
    const { getTennisApiKey } = await import("../lib/sports/tennis/provider.js");
    expect(getTennisApiKey()).toBe("dedicated-key");
  });
});

describe("getLiveMatches — TOUS les matchs en direct dans le monde, sans filtre de catégorie", () => {
  test("sans clé, renvoie une liste vide sans jamais appeler l'API", async () => {
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn();
    expect(await getLiveMatches(null)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("appelle /games?live=all avec le bon header d'authentification, sans aucun filtre de catégorie/tournoi", async () => {
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }] }) }));
    global.fetch = fetchMock;

    const games = await getLiveMatches(KEY);
    expect(games).toEqual([{ id: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/games?live=all");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "x-apisports-key": KEY });
  });

  test("plusieurs appels rapprochés ne déclenchent qu'un seul appel réel (cache court, 15-30s)", async () => {
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    global.fetch = fetchMock;

    await Promise.all([getLiveMatches(KEY), getLiveMatches(KEY), getLiveMatches(KEY)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("le cache expire bien après sa fenêtre (nouvel appel réel après 20s+)", async () => {
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    global.fetch = fetchMock;

    await getLiveMatches(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 21000);
    await getLiveMatches(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getMatchesByDate — matchs (tous statuts) d'une date précise, toutes catégories confondues", () => {
  test("sans clé ni date, renvoie une liste vide sans appeler l'API", async () => {
    const { getMatchesByDate } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn();
    expect(await getMatchesByDate("2026-08-01", null)).toEqual([]);
    expect(await getMatchesByDate(null, KEY)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("appelle /games?date=YYYY-MM-DD", async () => {
    const { getMatchesByDate } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 2 }] }) }));
    global.fetch = fetchMock;

    const games = await getMatchesByDate("2026-08-01", KEY);
    expect(games).toEqual([{ id: 2 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/games?date=2026-08-01");
  });

  test("deux dates différentes sont mises en cache séparément (pas de collision)", async () => {
    const { getMatchesByDate } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ url }] }) }));
    global.fetch = fetchMock;

    const a = await getMatchesByDate("2026-08-01", KEY);
    const b = await getMatchesByDate("2026-08-02", KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a).not.toEqual(b);
  });
});

describe("getGameById — relit un match précis", () => {
  test("sans id ni clé, repli honnête sans appel réseau", async () => {
    const { getGameById } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn();
    expect(await getGameById(null, KEY)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("appelle /games?id=X et renvoie le premier (et seul) élément", async () => {
    const { getGameById } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 42 }] }) }));
    global.fetch = fetchMock;

    const game = await getGameById(42, KEY);
    expect(game).toEqual({ id: 42 });
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/games?id=42");
  });
});

describe("getGameStatistics / getRankings / getPlayerStatistics / getPlayerGames / getHeadToHead / getTournaments", () => {
  test("chaque fonction exige ses paramètres et la clé, sinon repli honnête sans appel réseau", async () => {
    const provider = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn();

    expect(await provider.getGameStatistics(null, KEY)).toEqual([]);
    expect(await provider.getRankings(null, KEY)).toEqual([]);
    expect(await provider.getPlayerStatistics({ player: null, season: "2026" }, KEY)).toEqual([]);
    expect(await provider.getPlayerGames({ player: null, season: "2026" }, KEY)).toEqual([]);
    expect(await provider.getHeadToHead(null, 2, KEY)).toEqual([]);
    expect(await provider.getTournaments(null, null)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("getPlayerGames appelle /games?player=X&season=Y — base réelle de la forme récente", async () => {
    const { getPlayerGames } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }, { id: 2 }, { id: 3 }] }) }));
    global.fetch = fetchMock;

    const games = await getPlayerGames({ player: 101, season: "2026" }, KEY);
    expect(games).toHaveLength(3);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/games?player=101&season=2026");
  });

  test("getGameStatistics appelle /games/statistics?id=X", async () => {
    const { getGameStatistics } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ player: {} }] }) }));
    global.fetch = fetchMock;

    const stats = await getGameStatistics(555, KEY);
    expect(stats).toEqual([{ player: {} }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/games/statistics?id=555");
  });

  test("getRankings appelle /rankings?type=ATP et /rankings?type=WTA séparément, jamais mélangés", async () => {
    const { getRankings } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn((url) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ url }] }) })
    );
    global.fetch = fetchMock;

    const atp = await getRankings("ATP", KEY);
    const wta = await getRankings("WTA", KEY);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/rankings?type=ATP");
    expect(fetchMock.mock.calls[1][0]).toBe("https://v1.tennis.api-sports.io/rankings?type=WTA");
    expect(atp).not.toEqual(wta);
  });

  test("getPlayerStatistics appelle /players/statistics?player=X&season=Y", async () => {
    const { getPlayerStatistics } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ wins: 20 }] }) }));
    global.fetch = fetchMock;

    const stats = await getPlayerStatistics({ player: 99, season: "2026" }, KEY);
    expect(stats).toEqual([{ wins: 20 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/players/statistics?player=99&season=2026");
  });

  test("getHeadToHead appelle /games?h2h=id1-id2 avec les vrais identifiants des deux joueurs", async () => {
    const { getHeadToHead } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }, { id: 2 }] }) }));
    global.fetch = fetchMock;

    const games = await getHeadToHead(10, 20, KEY);
    expect(games).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/games?h2h=10-20");
  });

  test("getTournaments n'ajoute AUCUN filtre de catégorie — tous les tournois disponibles, sans exception", async () => {
    const { getTournaments } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }, { id: 2 }] }) }));
    global.fetch = fetchMock;

    const tournaments = await getTournaments(null, KEY);
    expect(tournaments).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v1.tennis.api-sports.io/leagues");
  });
});

describe("Pause après un 429 (quota quotidien dépassé) — même mécanique que les autres providers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("après un 429 (sans aucune donnée connue avant), l'erreur remonte — puis la pause empêche tout nouvel appel réseau", async () => {
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));
    global.fetch = fetchMock;

    await expect(getLiveMatches(KEY)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 21000);
    await expect(getLiveMatches(KEY)).rejects.toThrow(/pause/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("une fois la pause (~1h) écoulée, un nouvel appel réel est retenté et peut réussir", async () => {
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    let call = 0;
    const fetchMock = jest.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: false, status: 429 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 7 }] }) });
    });
    global.fetch = fetchMock;

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    await expect(getLiveMatches(KEY)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1_000_000 + 60 * 60 * 1000 + 1000);
    const games = await getLiveMatches(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(games).toEqual([{ id: 7 }]);
  });
});

describe("Repli honnête sur la dernière donnée connue, jamais une donnée inventée", () => {
  test("un incident passager (erreur réseau) après un premier succès retombe sur la dernière valeur connue", async () => {
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    let call = 0;
    const fetchMock = jest.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ id: 1 }] }) });
      return Promise.reject(new Error("network down"));
    });
    global.fetch = fetchMock;

    const first = await getLiveMatches(KEY);
    expect(first).toEqual([{ id: 1 }]);

    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 21000);
    const second = await getLiveMatches(KEY);
    expect(second).toEqual([{ id: 1 }]);
  });

  test("un échec sans AUCUNE donnée connue laisse l'erreur remonter (jamais masquée par une liste vide silencieuse)", async () => {
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.reject(new Error("network down")));
    await expect(getLiveMatches(KEY)).rejects.toThrow("network down");
  });
});
