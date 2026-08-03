/**
 * lib/apiQuota.js — suivi du quota API-SPORTS, INDÉPENDANT par sport (voir PROMPT :
 * "lis les en-têtes x-ratelimit-requests-remaining... compteur de quota indépendant
 * par sport"). recordQuotaUsage() incrémente le compteur du jour et retient le
 * dernier x-ratelimit-requests-remaining connu ; isQuotaExhausted() s'appuie
 * UNIQUEMENT sur cette valeur réelle, jamais déduite.
 */
function makeSupabaseMock(rows) {
  return {
    getSupabaseAdmin: () => ({
      from: (table) => {
        if (table !== "api_quota_usage") throw new Error(`table inattendue : ${table}`);
        return {
          upsert: (row) => {
            const idx = rows.findIndex((r) => r.sport === row.sport && r.day === row.day);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
            else rows.push({ ...row });
            return Promise.resolve({ error: null });
          },
          select: () => ({
            eq: (col1, val1) => ({
              eq: (col2, val2) => ({
                maybeSingle: () => {
                  const row = rows.find((r) => r[col1] === val1 && r[col2] === val2) || null;
                  return Promise.resolve({ data: row, error: null });
                },
              }),
            }),
          }),
        };
      },
    }),
  };
}

function makeCacheTableMock(rows) {
  return {
    upsert: (row) => {
      const idx = rows.findIndex((r) => r.cache_key === row.cache_key);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push({ ...row });
      return Promise.resolve({ error: null });
    },
    select: () => ({
      eq: (col, val) => ({
        maybeSingle: () => {
          const row = rows.find((r) => r[col] === val) || null;
          return Promise.resolve({ data: row, error: null });
        },
      }),
    }),
  };
}

function makeSupabaseMockWithCache(quotaRows, cacheRows) {
  return {
    getSupabaseAdmin: () => ({
      from: (table) => {
        if (table === "api_football_cache") return makeCacheTableMock(cacheRows);
        if (table === "api_quota_usage") return makeSupabaseMock(quotaRows).getSupabaseAdmin().from(table);
        throw new Error(`table inattendue : ${table}`);
      },
    }),
  };
}

function fakeResponse(headers) {
  const map = new Map(Object.entries(headers || {}));
  return { headers: { get: (name) => (map.has(name) ? map.get(name) : null) } };
}

beforeEach(() => {
  jest.resetModules();
});

test("recordQuotaUsage incrémente requests_used à chaque appel et retient le dernier x-ratelimit-requests-remaining", async () => {
  const rows = [];
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
  const { recordQuotaUsage, getQuotaSnapshot } = await import("../lib/apiQuota");

  await recordQuotaUsage("basketball", fakeResponse({ "x-ratelimit-requests-remaining": "97", "x-ratelimit-requests-limit": "100" }));
  await recordQuotaUsage("basketball", fakeResponse({ "x-ratelimit-requests-remaining": "96" }));

  const snapshot = await getQuotaSnapshot("basketball");
  expect(snapshot.requestsUsed).toBe(2);
  expect(snapshot.requestsRemaining).toBe(96);
  expect(snapshot.requestsLimit).toBe(100); // jamais écrasé par une valeur absente au 2e appel
});

test("isQuotaExhausted : true uniquement quand un en-tête réel confirme 0 restant aujourd'hui", async () => {
  const rows = [];
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
  const { recordQuotaUsage, isQuotaExhausted } = await import("../lib/apiQuota");

  expect(await isQuotaExhausted("basketball")).toBe(false); // aucune donnée connue -> jamais bloquant

  await recordQuotaUsage("basketball", fakeResponse({ "x-ratelimit-requests-remaining": "5" }));
  expect(await isQuotaExhausted("basketball")).toBe(false);

  await recordQuotaUsage("basketball", fakeResponse({ "x-ratelimit-requests-remaining": "0" }));
  expect(await isQuotaExhausted("basketball")).toBe(true);
});

test("le compteur est INDÉPENDANT par sport : épuiser le basket ne touche pas le football", async () => {
  const rows = [];
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
  const { recordQuotaUsage, isQuotaExhausted, getAllQuotaSnapshots } = await import("../lib/apiQuota");

  await recordQuotaUsage("basketball", fakeResponse({ "x-ratelimit-requests-remaining": "0" }));
  await recordQuotaUsage("football", fakeResponse({ "x-ratelimit-requests-remaining": "42" }));

  expect(await isQuotaExhausted("basketball")).toBe(true);
  expect(await isQuotaExhausted("football")).toBe(false);

  const snapshots = await getAllQuotaSnapshots(["football", "basketball"]);
  expect(snapshots).toEqual([
    expect.objectContaining({ sport: "football", requestsUsed: 1, requestsRemaining: 42 }),
    expect.objectContaining({ sport: "basketball", requestsUsed: 1, requestsRemaining: 0 }),
  ]);
});

test("recordLastError puis getLastError : retrouve le message et l'horodatage, sans affecter les autres sports", async () => {
  const cacheRows = [];
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMockWithCache([], cacheRows));
  const { recordLastError, getLastError } = await import("../lib/apiQuota");

  expect(await getLastError("basketball")).toBeNull(); // rien enregistré -> pas d'erreur inventée

  await recordLastError("basketball", "API-Basketball a répondu 403 sur /games?live=all");
  const entry = await getLastError("basketball");
  expect(entry.message).toBe("API-Basketball a répondu 403 sur /games?live=all");
  expect(entry.at).toEqual(expect.any(String));

  expect(await getLastError("football")).toBeNull(); // indépendant par sport, même cache partagé
});

test("aucune fonction ne jette jamais, même si Supabase est indisponible (table absente, migration pas encore exécutée...)", async () => {
  jest.doMock("../lib/supabaseAdmin", () => ({
    getSupabaseAdmin: () => {
      throw new Error("Configuration serveur manquante");
    },
  }));
  const { recordQuotaUsage, isQuotaExhausted, getQuotaSnapshot } = await import("../lib/apiQuota");

  await expect(recordQuotaUsage("basketball", fakeResponse({}))).resolves.toBeUndefined();
  await expect(isQuotaExhausted("basketball")).resolves.toBe(false);
  await expect(getQuotaSnapshot("basketball")).resolves.toEqual({
    sport: "basketball", requestsUsed: null, requestsRemaining: null, requestsLimit: null, updatedAt: null,
  });
});
