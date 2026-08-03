/**
 * pages/api/health/football.js — diagnostic en direct des 4 sources de données
 * (football-data.org, API-Football, API-Basketball, API-Tennis) : clé présente,
 * code HTTP réel, corps de l'erreur, quota. Réservé à l'administrateur (même garde
 * que /admin) puisque chaque appel déclenche de vrais appels réseau. Ne doit JAMAIS
 * planter, quelle que soit la source qui échoue.
 */
let mockSession = null;
jest.mock("../lib/session", () => ({ getSession: () => mockSession }));

const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function mockReqRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    ended: false,
    setHeader(k, v) { headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) { this.ended = true; this.body = body; return this; },
  };
  return { req: { headers: {}, cookies: {} }, res };
}

beforeEach(() => {
  jest.resetModules();
  process.env.ADMIN_EMAIL = "admin@example.com";
  mockSession = null;
  delete process.env.FOOTBALL_DATA_TOKEN;
  delete process.env.API_FOOTBALL_KEY;
  delete process.env.API_BASKETBALL_KEY;
  delete process.env.API_TENNIS_KEY;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
});

test("visiteur non-administrateur : 403, jamais le contenu du diagnostic", async () => {
  const { default: handler } = await import("../pages/api/health/football.js");
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(res.body).toBe("Non autorisé");
});

test("administrateur, aucune clé configurée : les 4 sources signalent keyPresent:false, jamais un plantage", async () => {
  mockSession = { id: "u1", email: "admin@example.com" };
  global.fetch = jest.fn(() => Promise.reject(new Error("ne devrait jamais être appelé sans clé")));

  const { default: handler } = await import("../pages/api/health/football.js");
  const { req, res } = mockReqRes();
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res.body.sources).toHaveLength(4);
  for (const s of res.body.sources) {
    expect(s.keyPresent).toBe(false);
    expect(s.ok).toBe(false);
  }
  expect(global.fetch).not.toHaveBeenCalled();
});

test("administrateur, toutes les clés présentes : renvoie le code HTTP réel, le corps de l'erreur ET le quota — jamais un plantage même si une source répond mal", async () => {
  mockSession = { id: "u1", email: "admin@example.com" };
  process.env.FOOTBALL_DATA_TOKEN = "fd-token";
  process.env.API_FOOTBALL_KEY = "af-key";

  global.fetch = jest.fn((url) => {
    if (url.includes("api.football-data.org")) {
      return Promise.resolve({ ok: false, status: 429, headers: { get: () => null }, text: () => Promise.resolve("quota exceeded") });
    }
    if (url.includes("v3.football.api-sports.io/status")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { subscription: { active: true, plan: "Free" }, requests: { current: 42, limit_day: 100 } } }),
      });
    }
    if (url.includes("v1.basketball.api-sports.io/status")) {
      return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ errors: { subscription: "no active subscription" } }) });
    }
    // API-Tennis : pas de clé configurée séparément, retombe sur API_FOOTBALL_KEY —
    // simule ici une panne réseau totale (ni status ni body).
    return Promise.reject(new Error("network unreachable"));
  });

  const { default: handler } = await import("../pages/api/health/football.js");
  const { req, res } = mockReqRes();
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const bySource = Object.fromEntries(res.body.sources.map((s) => [s.name, s]));

  expect(bySource["football-data.org"].keyPresent).toBe(true);
  expect(bySource["football-data.org"].httpStatus).toBe(429);
  expect(bySource["football-data.org"].ok).toBe(false);
  expect(bySource["football-data.org"].errorBody).toContain("quota exceeded");

  expect(bySource["API-Football"].ok).toBe(true);
  expect(bySource["API-Football"].quota).toEqual({ plan: "Free", subscriptionActive: true, current: 42, limitDay: 100 });

  expect(bySource["API-Basketball"].httpStatus).toBe(403);
  expect(bySource["API-Basketball"].ok).toBe(false);
  expect(bySource["API-Basketball"].errorBody).toContain("subscription");

  expect(bySource["API-Tennis"].ok).toBe(false);
  expect(bySource["API-Tennis"].httpStatus).toBeNull();
  expect(bySource["API-Tennis"].errorBody).toContain("network unreachable");
});

test("ADMIN_EMAIL non définie : 403 même pour une session qui y ressemblerait", async () => {
  delete process.env.ADMIN_EMAIL;
  mockSession = { id: "u1", email: "admin@example.com" };
  const { default: handler } = await import("../pages/api/health/football.js");
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(403);
});
