/**
 * pages/api/admin/recompute.js — action d'administration réservée au propriétaire :
 *   1. visiteur non connecté -> 403
 *   2. connecté mais PAS l'administrateur -> 403
 *   3. administrateur -> autorisé (200)
 *   4. requête sans origine valide (CSRF) -> refusée, même pour l'administrateur
 *   5. ADMIN_EMAIL non définie -> jamais d'écriture autorisée, même avec une session
 *      qui "ressemblerait" à l'administrateur
 */
import handler from "../pages/api/admin/recompute";
import { __resetRateLimitForTests } from "../lib/security/rateLimit";

let mockSession = null;
jest.mock("../lib/session", () => ({
  getSession: () => mockSession,
}));

jest.mock("../lib/comboHistory", () => ({
  maintainAndGetComboStats: jest.fn(() => Promise.resolve({ successRates: { faible: { pct: 80, total: 5 } }, progress: {} })),
}));
jest.mock("../lib/pronosticHistory", () => ({
  listAndMaintainHistory: jest.fn(() => Promise.resolve([{ id: 1 }])),
  listRecentPredictionsForDuplicateCheck: jest.fn(() => Promise.resolve([])),
}));

const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function mockReqRes({ method = "POST", origin = "https://blume.example.com", host = "blume.example.com" } = {}) {
  const req = { method, headers: { origin, host }, socket: {}, cookies: {} };
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  mockSession = null;
  __resetRateLimitForTests();
});

afterAll(() => {
  if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
});

test("1. visiteur NON connecté : 403", async () => {
  mockSession = null;
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(res.body.error).toBe("Non autorisé");
});

test("2. connecté mais PAS l'administrateur : 403", async () => {
  mockSession = { id: "quelquun-dautre", email: "quelquun@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(res.body.error).toBe("Non autorisé");
});

test("3. l'administrateur : autorisé (200)", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toHaveProperty("comboSuccessRates");
  // BLOC 2 : vérification automatique obligatoire (lib/lineDuplicateCheck.js) — jamais
  // masquée, exposée directement dans la réponse de cette route de maintenance.
  expect(res.body.duplicateLineWarnings).toEqual([]);
});

test("4. administrateur mais requête d'une origine étrangère : refusée (CSRF)", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes({ origin: "https://attaquant.example.net" });
  await handler(req, res);
  expect(res.statusCode).toBe(403);
});

test("4bis. administrateur mais sans Origin ni Referer : refusée (jamais une autorisation implicite)", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes({ origin: undefined });
  delete req.headers.origin;
  await handler(req, res);
  expect(res.statusCode).toBe(403);
});

test("5. ADMIN_EMAIL non définie : jamais d'écriture autorisée, même avec une session qui y ressemble", async () => {
  delete process.env.ADMIN_EMAIL;
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(403);
});

test("6. BLOC 2 : deux pronostics récents avec des lignes strictement identiques sont signalés, jamais masqués", async () => {
  const { listRecentPredictionsForDuplicateCheck } = require("../lib/pronosticHistory");
  const samePronostic = {
    markets: { totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] } },
    matchStats: {},
    correctScores: [],
  };
  listRecentPredictionsForDuplicateCheck.mockResolvedValueOnce([
    { matchId: "111", pronostic: samePronostic },
    { matchId: "222", pronostic: samePronostic },
  ]);

  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res.body.duplicateLineWarnings).toEqual([["111", "222"]]);
});

test("méthode autre que POST : refusée (405), avant même le contrôle admin", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes({ method: "GET" });
  await handler(req, res);
  expect(res.statusCode).toBe(405);
});

test("rate limiting : au-delà du quota, même l'administrateur reçoit 429", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  for (let i = 0; i < 10; i++) {
    const { req, res } = mockReqRes();
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  }
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(429);
});
