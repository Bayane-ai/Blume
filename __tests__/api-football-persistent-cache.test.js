/**
 * lib/apiFootball.js — cache PERSISTANT (table api_football_cache, voir
 * supabase/migrations/0015_api_football_cache.sql), ajouté suite à un signalement réel :
 * des compétitions entières (Russie, Écosse, Norvège, Supercoupe des Pays-Bas...)
 * restaient invisibles malgré API_FOOTBALL_KEY correctement configurée en production.
 * Cause : le cache en mémoire de ce fichier ne survit pas d'une instance Vercel
 * "froide" à l'autre — sous trafic réel, chaque instance repart de zéro et épuise vite
 * le quota gratuit (100 requêtes/jour), après quoi tout ce qui dépend uniquement
 * d'API-Football disparaît silencieusement jusqu'au lendemain.
 *
 * Ces tests simulent explicitement DEUX instances froides successives (deux imports
 * frais du module via jest.resetModules(), chacune avec son propre cache en mémoire
 * vide) partageant la même table Supabase simulée — exactement le scénario réel.
 */
const AF_KEY = "test-af-key";

function makeSupabaseMock(rows) {
  return {
    getSupabaseAdmin: () => ({
      from: (table) => {
        if (table !== "api_football_cache") throw new Error(`table inattendue : ${table}`);
        return {
          upsert: (row) => {
            const idx = rows.findIndex((r) => r.cache_key === row.cache_key);
            if (idx >= 0) rows[idx] = { ...row };
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
      },
    }),
  };
}

beforeEach(() => {
  jest.resetModules();
});

test("getFixturesByDate : une deuxième instance 'froide' réutilise le cache persisté par la première, sans rappeler l'API", async () => {
  const rows = [];
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));

  const fetchMock = jest.fn((url) => {
    const parsed = new URL(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          response: [{ fixture: { id: 1, date: "2026-08-02T16:00:00Z", status: { short: "NS" } }, league: { id: 999, name: "Eliteserien", country: "Norway" }, teams: { home: { id: 1 }, away: { id: 2 } } }],
          paging: { current: 1, total: 1 },
        }),
    });
  });
  global.fetch = fetchMock;

  // Instance 1 (froide) : cache en mémoire vide, appelle réellement l'API, puis écrit
  // le résultat dans la table Supabase simulée (partagée entre les deux "instances").
  const mod1 = await import("../lib/apiFootball");
  const fixtures1 = await mod1.getFixturesByDate("2026-08-02", AF_KEY);
  expect(fixtures1).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  // Laisse l'écriture "fire-and-forget" dans le cache persistant se terminer.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(rows.some((r) => r.cache_key === "upcoming:2026-08-02")).toBe(true);

  // Instance 2 (froide) : nouveau module, cache en mémoire vide à nouveau, mais la
  // MÊME table Supabase simulée que l'instance 1 — c'est exactement ce qu'une vraie
  // instance Vercel qui redémarre verrait en production.
  jest.resetModules();
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
  fetchMock.mockClear();
  const mod2 = await import("../lib/apiFootball");
  const fixtures2 = await mod2.getFixturesByDate("2026-08-02", AF_KEY);

  expect(fixtures2).toHaveLength(1);
  expect(fixtures2[0].league.country).toBe("Norway");
  // Le point clé : la deuxième instance ne rappelle PAS l'API, elle réutilise le
  // cache persisté par la première.
  expect(fetchMock).not.toHaveBeenCalled();
});

test("getAllLiveFixtures : une deuxième instance 'froide' réutilise le cache persisté par la première", async () => {
  const rows = [];
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));

  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          response: [{ fixture: { id: 2, status: { short: "1H" } }, league: { id: 235, name: "Premier League", country: "Russia" }, teams: { home: { id: 3 }, away: { id: 4 } } }],
          paging: { current: 1, total: 1 },
        }),
    })
  );
  global.fetch = fetchMock;

  const mod1 = await import("../lib/apiFootball");
  const fixtures1 = await mod1.getAllLiveFixtures(AF_KEY);
  expect(fixtures1).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(rows.some((r) => r.cache_key === "live_all")).toBe(true);

  jest.resetModules();
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
  fetchMock.mockClear();
  const mod2 = await import("../lib/apiFootball");
  const fixtures2 = await mod2.getAllLiveFixtures(AF_KEY);

  expect(fixtures2).toHaveLength(1);
  expect(fixtures2[0].league.country).toBe("Russia");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("la pause anti-quota (429) déclenchée par une instance est respectée par une deuxième instance 'froide'", async () => {
  const rows = [];
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));

  const fetchMock = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));
  global.fetch = fetchMock;

  const mod1 = await import("../lib/apiFootball");
  await expect(mod1.getAllLiveFixtures(AF_KEY)).resolves.toEqual([]); // repli gracieux, jamais une erreur qui casse l'appelant
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(rows.some((r) => r.cache_key === "quota_backoff_until")).toBe(true);

  jest.resetModules();
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
  fetchMock.mockClear();
  const mod2 = await import("../lib/apiFootball");
  await mod2.getAllLiveFixtures(AF_KEY);
  // La deuxième instance voit la pause déjà enregistrée par la première et ne tente
  // même pas l'appel réseau.
  expect(fetchMock).not.toHaveBeenCalled();
});
