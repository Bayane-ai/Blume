/**
 * lib/sports/tennis/provider.js — client Live Tennis API (https://api.livetennisapi.com),
 * fournisseur DIFFÉRENT d'API-SPORTS (football/basket) : clé dédiée TENNIS_API_KEY,
 * en-tête Authorization: Bearer, plan gratuit limité (live only, pas d'historique) et
 * un quota STRICT (30/min, 1000/jour) auto-limité avec marge de sécurité (950/28) —
 * voir PROMPT. Couvre les 4 scénarios demandés : réponse OK, 429, 401, réponse vide,
 * et panne réseau totale (timeout).
 */
const KEY = "test-tennis-key";

function makeCacheMock(store = new Map()) {
  return {
    readPersistentCache: jest.fn((key) => {
      const entry = store.get(key);
      return Promise.resolve(entry ? { payload: entry.payload, fetchedAt: entry.fetchedAt } : null);
    }),
    writePersistentCache: jest.fn((key, payload) => {
      store.set(key, { payload, fetchedAt: Date.now() });
    }),
    __store: store,
  };
}

beforeEach(() => {
  jest.resetModules();
  delete process.env.TENNIS_API_KEY;
});

describe("getTennisApiKey — clé DÉDIÉE, jamais de repli sur une clé d'un autre sport", () => {
  test("aucune clé définie : null", async () => {
    const { getTennisApiKey } = await import("../lib/sports/tennis/provider.js");
    expect(getTennisApiKey()).toBeNull();
  });

  test("TENNIS_API_KEY définie : reprise telle quelle", async () => {
    process.env.TENNIS_API_KEY = "real-key";
    const { getTennisApiKey } = await import("../lib/sports/tennis/provider.js");
    expect(getTennisApiKey()).toBe("real-key");
  });
});

describe("checkTennisHealth — GET /health, sans clé, jamais compté dans le quota", () => {
  test("connectivité OK", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200 }));
    const { checkTennisHealth } = await import("../lib/sports/tennis/provider.js");
    const result = await checkTennisHealth();
    expect(result).toEqual({ ok: true, status: 200 });
    expect(global.fetch).toHaveBeenCalledWith("https://api.livetennisapi.com/api/public/v1/health");
  });

  test("panne réseau totale : jamais un plantage, ok:false explicite", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("ECONNRESET")));
    const { checkTennisHealth } = await import("../lib/sports/tennis/provider.js");
    const result = await checkTennisHealth();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNRESET");
  });
});

describe("getLiveMatches — réponse OK (200)", () => {
  test("sans clé, liste vide sans jamais appeler l'API", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn();
    expect(await getLiveMatches(null)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("appelle /matches?status=live avec Authorization: Bearer <clé>", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [{ id: 1 }] }) }));
    global.fetch = fetchMock;

    const matches = await getLiveMatches(KEY);
    expect(matches).toEqual([{ id: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.livetennisapi.com/api/public/v1/matches?status=live");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: `Bearer ${KEY}` });
  });

  test("un seul appel réel partagé (cache persistant 60s) même pour plusieurs visiteurs à la fois", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) }));
    global.fetch = fetchMock;

    await getLiveMatches(KEY);
    await getLiveMatches(KEY); // même minute -> cache encore frais, aucun 2e appel
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getLiveMatches — réponse vide (200 OK, 0 match)", () => {
  test("ce n'est pas une erreur : liste vide honnête, jamais un plantage", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) }));
    expect(await getLiveMatches(KEY)).toEqual([]);
  });
});

describe("getLiveMatches — 429 (quota atteint côté API)", () => {
  test("sans cache connu : l'erreur remonte, jamais une liste vide silencieuse", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("rate limited") }));
    await expect(getLiveMatches(KEY)).rejects.toThrow(/429/);
  });

  test("avec un cache persistant connu : sert la dernière liste connue plutôt que l'erreur", async () => {
    const store = new Map();
    store.set("tennis:livetennisapi:live", { payload: [{ id: 9 }], fetchedAt: Date.now() - 5 * 60 * 1000 });
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock(store));
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("rate limited") }));
    expect(await getLiveMatches(KEY)).toEqual([{ id: 9 }]);
  });
});

describe("getLiveMatches — 401 (clé invalide)", () => {
  test("sans cache connu : l'erreur remonte avec le code exact", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("invalid token") }));
    await expect(getLiveMatches(KEY)).rejects.toThrow(/401/);
  });
});

describe("getLiveMatches — panne réseau totale (timeout / l'API ne répond pas)", () => {
  test("sans cache connu : l'erreur remonte, jamais un plantage silencieux", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.reject(new Error("ETIMEDOUT")));
    await expect(getLiveMatches(KEY)).rejects.toThrow("ETIMEDOUT");
  });

  test("avec un cache persistant connu : sert la dernière liste connue", async () => {
    const store = new Map();
    store.set("tennis:livetennisapi:live", { payload: [{ id: 4 }], fetchedAt: Date.now() - 2 * 60 * 1000 });
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock(store));
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.reject(new Error("ETIMEDOUT")));
    expect(await getLiveMatches(KEY)).toEqual([{ id: 4 }]);
  });
});

describe("Quota STRICT auto-limité (30/min, 1000/jour réels -> marge de sécurité 28/950)", () => {
  test("compteur journalier déjà à la limite de sécurité : bloque AVANT tout appel réel, sert le cache", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const store = new Map();
    store.set(`tennis:livetennisapi:day:${today}`, { payload: { count: 950 }, fetchedAt: Date.now() });
    store.set("tennis:livetennisapi:live", { payload: [{ id: 5 }], fetchedAt: Date.now() - 60000 });
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock(store));
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    expect(await getLiveMatches(KEY)).toEqual([{ id: 5 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("compteur par minute déjà à la limite de sécurité : bloque aussi, même si le quota du jour est large", async () => {
    const minuteKey = `tennis:livetennisapi:minute:${Math.floor(Date.now() / 60000)}`;
    const store = new Map();
    store.set(minuteKey, { payload: { count: 28 }, fetchedAt: Date.now() });
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock(store));
    const { getLiveMatches } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await expect(getLiveMatches(KEY)).rejects.toThrow(/quota/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("un appel réel réussi incrémente bien les deux compteurs (jour et minute)", async () => {
    const store = new Map();
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock(store));
    const { getLiveMatches, getTennisQuotaUsageToday } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) }));

    await getLiveMatches(KEY);
    const usage = await getTennisQuotaUsageToday();
    expect(usage.requestsToday).toBe(1);
    expect(usage.requestsThisMinute).toBe(1);
    expect(usage.dailyCap).toBe(950);
    expect(usage.minuteCap).toBe(28);
  });
});

describe("getMatchScore / getPlayer — jamais bloquants pour l'affichage du match lui-même", () => {
  test("getMatchScore : échec -> null en repli (pas d'exception), la carte reste affichable sans le détail", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getMatchScore } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("boom") }));
    expect(await getMatchScore("555", KEY)).toBeNull();
  });

  test("getMatchScore : appelle /matches/{id}/score avec le bon en-tête", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getMatchScore } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { sets: [] } }) }));
    global.fetch = fetchMock;

    const score = await getMatchScore("555", KEY);
    expect(score).toEqual({ sets: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.livetennisapi.com/api/public/v1/matches/555/score");
  });

  test("getPlayer : sans id ni clé, repli honnête sans appel réseau", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getPlayer } = await import("../lib/sports/tennis/provider.js");
    global.fetch = jest.fn();
    expect(await getPlayer(null, KEY)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("getPlayer : appelle /players/{id}", async () => {
    jest.doMock("../lib/apiSportsCache", () => makeCacheMock());
    const { getPlayer } = await import("../lib/sports/tennis/provider.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { ranking: 5 } }) }));
    global.fetch = fetchMock;

    const player = await getPlayer("101", KEY);
    expect(player).toEqual({ ranking: 5 });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.livetennisapi.com/api/public/v1/players/101");
  });
});
