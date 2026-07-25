/**
 * pages/api/search-history.js et pages/api/favorites.js — historique de recherche et
 * compétitions favorites, personnels à chaque compte, filtrés par profile_id (voir
 * supabase/migrations/0008_custom_auth.sql). TOUJOURS filtré par le profile_id de LA
 * SESSION — jamais un identifiant fourni par le client (même principe que
 * __tests__/match-history-api.test.js).
 */
import searchHistoryHandler from "../pages/api/search-history";
import favoritesHandler from "../pages/api/favorites";

let mockSession = null;
jest.mock("../lib/session", () => ({
  getSession: () => mockSession,
}));
jest.mock("../lib/security/guardMutation", () => ({ guardMutation: () => true }));

let searchRows;
let favoriteRows;

jest.mock("../lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table) => {
      if (table === "search_history") {
        return {
          insert: (row) => { searchRows.push({ ...row, created_at: new Date().toISOString() }); return Promise.resolve({ error: null }); },
          select: () => {
            const filters = [];
            const builder = {
              eq: (col, val) => { filters.push([col, val]); return builder; },
              order: () => builder,
              limit: () => builder,
              then: (resolve) => {
                const result = searchRows.filter((r) => filters.every(([c, v]) => r[c] === v));
                return Promise.resolve({ data: result, error: null }).then(resolve);
              },
            };
            return builder;
          },
        };
      }
      if (table === "favorites") {
        return {
          upsert: (row) => {
            const idx = favoriteRows.findIndex((r) => r.profile_id === row.profile_id && r.kind === row.kind && r.ref_id === row.ref_id);
            if (idx >= 0) favoriteRows[idx] = { ...favoriteRows[idx], ...row };
            else favoriteRows.push({ ...row });
            return Promise.resolve({ error: null });
          },
          delete: () => {
            const filters = [];
            const builder = {
              eq: (col, val) => { filters.push([col, val]); return builder; },
              then: (resolve) => {
                favoriteRows = favoriteRows.filter((r) => !filters.every(([c, v]) => r[c] === v));
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return builder;
          },
          select: () => {
            const filters = [];
            const builder = {
              eq: (col, val) => { filters.push([col, val]); return builder; },
              then: (resolve) => {
                const result = favoriteRows.filter((r) => filters.every(([c, v]) => r[c] === v));
                return Promise.resolve({ data: result, error: null }).then(resolve);
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`table inattendue dans le test : ${table}`);
    },
  }),
}));

function mockReqRes({ method = "GET", body, query } = {}) {
  const req = { method, body, query, headers: {}, cookies: {}, socket: {} };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

const SESSION_A = { id: "profile-a", email: "alice@example.com" };
const SESSION_B = { id: "profile-b", email: "bob@example.com" };

beforeEach(() => {
  searchRows = [];
  favoriteRows = [];
  mockSession = SESSION_A;
});

describe("pages/api/search-history.js", () => {
  test("aucune session : 401", async () => {
    mockSession = null;
    const { req, res } = mockReqRes();
    await searchHistoryHandler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test("sauvegarde une recherche puis la retrouve, propre à la session", async () => {
    const post = mockReqRes({ method: "POST", body: { query: "arsenal" } });
    await searchHistoryHandler(post.req, post.res);
    expect(post.res.statusCode).toBe(200);

    const get = mockReqRes({ method: "GET" });
    await searchHistoryHandler(get.req, get.res);
    expect(get.res.body.queries).toEqual(["arsenal"]);
  });

  test("recherche trop courte : refusée (400)", async () => {
    const { req, res } = mockReqRes({ method: "POST", body: { query: "a" } });
    await searchHistoryHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test("isolation par session : les recherches d'un autre compte n'apparaissent jamais ici", async () => {
    mockSession = SESSION_A;
    await searchHistoryHandler(...Object.values(mockReqRes({ method: "POST", body: { query: "arsenal" } })));

    mockSession = SESSION_B;
    const get = mockReqRes({ method: "GET" });
    await searchHistoryHandler(get.req, get.res);
    expect(get.res.body.queries).toEqual([]);
  });
});

describe("pages/api/favorites.js", () => {
  test("aucune session : 401", async () => {
    mockSession = null;
    const { req, res } = mockReqRes();
    await favoritesHandler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test("ajoute un favori puis le retrouve, propre à la session", async () => {
    const post = mockReqRes({ method: "POST", body: { code: "PL", label: "Premier League" } });
    await favoritesHandler(post.req, post.res);
    expect(post.res.statusCode).toBe(200);

    const get = mockReqRes({ method: "GET" });
    await favoritesHandler(get.req, get.res);
    expect(get.res.body.codes).toEqual(["PL"]);
  });

  test("retire un favori", async () => {
    await favoritesHandler(...Object.values(mockReqRes({ method: "POST", body: { code: "PL" } })));
    const del = mockReqRes({ method: "DELETE", body: { code: "PL" } });
    await favoritesHandler(del.req, del.res);
    expect(del.res.statusCode).toBe(200);

    const get = mockReqRes({ method: "GET" });
    await favoritesHandler(get.req, get.res);
    expect(get.res.body.codes).toEqual([]);
  });

  test("isolation par session : les favoris d'un autre compte n'apparaissent jamais ici", async () => {
    mockSession = SESSION_A;
    await favoritesHandler(...Object.values(mockReqRes({ method: "POST", body: { code: "PL" } })));

    mockSession = SESSION_B;
    const get = mockReqRes({ method: "GET" });
    await favoritesHandler(get.req, get.res);
    expect(get.res.body.codes).toEqual([]);
  });
});
