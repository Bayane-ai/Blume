/**
 * pages/api/admin/recompute.js — action d'administration réservée au propriétaire :
 *   1. visiteur non connecté -> 403
 *   2. connecté mais PAS le propriétaire -> 403
 *   3. propriétaire -> autorisé (200)
 *   4. requête sans origine valide (CSRF) -> refusée, même pour le propriétaire
 *   5. OWNER_ID non défini -> jamais d'écriture autorisée, même avec une session qui
 *      "ressemblerait" au propriétaire
 */
import handler from "../pages/api/admin/recompute";
import { __resetRateLimitForTests } from "../lib/security/rateLimit";

let mockUser = null;
jest.mock("../lib/supabaseServer", () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
  }),
}));

jest.mock("../lib/comboHistory", () => ({
  maintainAndGetComboStats: jest.fn(() => Promise.resolve({ successRates: { faible: { pct: 80, total: 5 } }, progress: {} })),
}));
jest.mock("../lib/pronosticHistory", () => ({
  listAndMaintainHistory: jest.fn(() => Promise.resolve([{ id: 1 }])),
}));

const ORIGINAL_OWNER_ID = process.env.OWNER_ID;

function mockReqRes({ method = "POST", origin = "https://blume.example.com", host = "blume.example.com" } = {}) {
  const req = { method, headers: { origin, host }, socket: {} };
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
  process.env.OWNER_ID = "user-owner";
  mockUser = null;
  __resetRateLimitForTests();
});

afterAll(() => {
  if (ORIGINAL_OWNER_ID === undefined) delete process.env.OWNER_ID;
  else process.env.OWNER_ID = ORIGINAL_OWNER_ID;
});

test("1. visiteur NON connecté : 403", async () => {
  mockUser = null;
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(res.body.error).toBe("Non autorisé");
});

test("2. connecté mais PAS le propriétaire : 403", async () => {
  mockUser = { id: "quelquun-dautre", email: "quelquun@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(res.body.error).toBe("Non autorisé");
});

test("3. le propriétaire : autorisé (200)", async () => {
  mockUser = { id: "user-owner", email: "owner@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toHaveProperty("comboSuccessRates");
});

test("4. propriétaire mais requête d'une origine étrangère : refusée (CSRF)", async () => {
  mockUser = { id: "user-owner", email: "owner@example.com" };
  const { req, res } = mockReqRes({ origin: "https://attaquant.example.net" });
  await handler(req, res);
  expect(res.statusCode).toBe(403);
});

test("4bis. propriétaire mais sans Origin ni Referer : refusée (jamais une autorisation implicite)", async () => {
  mockUser = { id: "user-owner", email: "owner@example.com" };
  const { req, res } = mockReqRes({ origin: undefined });
  delete req.headers.origin;
  await handler(req, res);
  expect(res.statusCode).toBe(403);
});

test("5. OWNER_ID non défini : jamais d'écriture autorisée, même avec une session qui y ressemble", async () => {
  delete process.env.OWNER_ID;
  mockUser = { id: "user-owner", email: "owner@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.statusCode).toBe(403);
});

test("méthode autre que POST : refusée (405), avant même le contrôle propriétaire", async () => {
  mockUser = { id: "user-owner", email: "owner@example.com" };
  const { req, res } = mockReqRes({ method: "GET" });
  await handler(req, res);
  expect(res.statusCode).toBe(405);
});

test("rate limiting : au-delà du quota, même le propriétaire reçoit 429", async () => {
  mockUser = { id: "user-owner", email: "owner@example.com" };
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
