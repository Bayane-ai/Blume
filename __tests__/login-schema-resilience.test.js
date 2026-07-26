/**
 * pages/api/auth/login.js — non-régression pour le bug réel rencontré en production :
 * "Could not find the 'last_login_at' column of 'profiles' in the schema cache".
 *
 * L'upsert essentiel (id + email, ce qui autorise la connexion) doit être totalement
 * isolé de la mise à jour accessoire de last_login_at : un souci sur cette seconde
 * colonne (absente, cache de schéma périmé, erreur réseau...) ne doit JAMAIS empêcher
 * la connexion. Et dans tous les cas, aucun détail technique de base de données ne
 * doit jamais atteindre le client — seulement les logs serveur.
 */
import handler from "../pages/api/auth/login";

const ORIGINAL_AUTH_SECRET = process.env.AUTH_SESSION_SECRET;

function mockReqRes({ method = "POST", email, origin = "https://blume.example.com", host = "blume.example.com" } = {}) {
  const req = {
    method,
    headers: { origin, host },
    socket: {},
    cookies: {},
    body: email !== undefined ? { email } : undefined,
  };
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  process.env.AUTH_SESSION_SECRET = "secret-de-test-suffisamment-long";
  jest.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SESSION_SECRET;
  else process.env.AUTH_SESSION_SECRET = ORIGINAL_AUTH_SECRET;
});

test("l'upsert essentiel ne porte QUE sur email (jamais last_login_at) — vérifié via les arguments reçus", async () => {
  const upsertArgs = [];
  jest.doMock("../lib/supabaseAdmin", () => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        upsert: (row, opts) => {
          upsertArgs.push({ row, opts });
          return { select: () => ({ single: async () => ({ data: { id: "p1", email: row.email }, error: null }) }) };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    }),
  }));
  jest.resetModules();
  const freshHandler = require("../pages/api/auth/login").default;

  const { req, res } = mockReqRes({ email: "test@example.com" });
  await freshHandler(req, res);

  expect(res.statusCode).toBe(200);
  expect(upsertArgs).toHaveLength(1);
  expect(upsertArgs[0].row).toEqual({ email: "test@example.com" });
  expect(upsertArgs[0].row).not.toHaveProperty("last_login_at");
  expect(upsertArgs[0].opts).toEqual({ onConflict: "email" });
  jest.dontMock("../lib/supabaseAdmin");
});

test(
  "la mise à jour de last_login_at échoue (colonne absente du cache de schéma) : la connexion RÉUSSIT quand même, " +
    "l'erreur est seulement loggée côté serveur, jamais renvoyée au client",
  async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const SCHEMA_CACHE_ERROR = "Could not find the 'last_login_at' column of 'profiles' in the schema cache";

    jest.doMock("../lib/supabaseAdmin", () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          upsert: (row) => ({
            select: () => ({ single: async () => ({ data: { id: "p1", email: row.email }, error: null }) }),
          }),
          update: () => ({
            eq: async () => ({ error: { message: SCHEMA_CACHE_ERROR } }),
          }),
        }),
      }),
    }));
    jest.resetModules();
    const freshHandler = require("../pages/api/auth/login").default;

    const { req, res } = mockReqRes({ email: "test@example.com" });
    await freshHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(JSON.stringify(res.body)).not.toMatch(/schema cache|last_login_at|column/i);

    // L'erreur réelle est bien allée dans les logs serveur, pas silencieusement perdue.
    const loggedCalls = consoleErrorSpy.mock.calls.map((args) => args.join(" "));
    expect(loggedCalls.some((line) => line.includes(SCHEMA_CACHE_ERROR))).toBe(true);

    jest.dontMock("../lib/supabaseAdmin");
    consoleErrorSpy.mockRestore();
  }
);

test("la mise à jour de last_login_at lève une exception réseau : la connexion RÉUSSIT quand même", async () => {
  const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

  jest.doMock("../lib/supabaseAdmin", () => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        upsert: (row) => ({
          select: () => ({ single: async () => ({ data: { id: "p1", email: row.email }, error: null }) }),
        }),
        update: () => ({
          eq: async () => {
            throw new Error("fetch failed: network error");
          },
        }),
      }),
    }),
  }));
  jest.resetModules();
  const freshHandler = require("../pages/api/auth/login").default;

  const { req, res } = mockReqRes({ email: "test@example.com" });
  await freshHandler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true });

  jest.dontMock("../lib/supabaseAdmin");
  consoleErrorSpy.mockRestore();
});

test("l'upsert ESSENTIEL échoue (colonne email absente, panne réelle) : 500, message générique en français, jamais le détail technique", async () => {
  const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const DB_ERROR = "column \"email\" of relation \"profiles\" does not exist";

  jest.doMock("../lib/supabaseAdmin", () => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        upsert: () => ({
          select: () => ({ single: async () => ({ data: null, error: { message: DB_ERROR } }) }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    }),
  }));
  jest.resetModules();
  const freshHandler = require("../pages/api/auth/login").default;

  const { req, res } = mockReqRes({ email: "test@example.com" });
  await freshHandler(req, res);

  expect(res.statusCode).toBe(500);
  expect(res.body.error).not.toMatch(/column|relation|does not exist|postgres/i);
  expect(res.body.error.length).toBeGreaterThan(0);

  const loggedCalls = consoleErrorSpy.mock.calls.map((args) => args.join(" "));
  expect(loggedCalls.some((line) => line.includes(DB_ERROR))).toBe(true);

  jest.dontMock("../lib/supabaseAdmin");
  consoleErrorSpy.mockRestore();
});
