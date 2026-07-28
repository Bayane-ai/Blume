/**
 * pages/api/admin/team-profile.js — action d'administration réservée au propriétaire
 * (voir __tests__/admin-recompute.test.js pour le même principe) :
 *   1. visiteur non connecté -> 403
 *   2. connecté mais PAS l'administrateur -> 403
 *   3. administrateur -> autorisé (200), appelle getOrRefreshTeamProfile
 *   4. requête d'origine étrangère -> refusée (CSRF), même pour l'administrateur
 *   5. teamName manquant -> 400
 */
import handler from "../pages/api/admin/team-profile";
import { __resetRateLimitForTests } from "../lib/security/rateLimit";

let mockSession = null;
jest.mock("../lib/session", () => ({
  getSession: () => mockSession,
}));

const getOrRefreshTeamProfile = jest.fn(() =>
  Promise.resolve({ available: true, teamName: "Real Madrid", overall: {}, home: {}, away: {}, firstHalf: {} })
);
jest.mock("../lib/teamStatProfiles", () => ({
  getOrRefreshTeamProfile: (...args) => getOrRefreshTeamProfile(...args),
}));

const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function mockReqRes({ method = "POST", origin = "https://blume.example.com", host = "blume.example.com", body } = {}) {
  const req = { method, headers: { origin, host }, socket: {}, cookies: {}, body };
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
  getOrRefreshTeamProfile.mockClear();
  __resetRateLimitForTests();
});

afterAll(() => {
  if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
});

test("1. visiteur NON connecté : 403", async () => {
  const { req, res } = mockReqRes({ body: { teamName: "Real Madrid" } });
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(getOrRefreshTeamProfile).not.toHaveBeenCalled();
});

test("2. connecté mais PAS l'administrateur : 403", async () => {
  mockSession = { id: "quelquun-dautre", email: "quelquun@example.com" };
  const { req, res } = mockReqRes({ body: { teamName: "Real Madrid" } });
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(getOrRefreshTeamProfile).not.toHaveBeenCalled();
});

test("3. l'administrateur : autorisé (200), appelle getOrRefreshTeamProfile avec les bons paramètres", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes({ body: { teamName: "Real Madrid", competitionCode: "PD" } });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.available).toBe(true);
  expect(getOrRefreshTeamProfile).toHaveBeenCalledWith(
    expect.objectContaining({ teamName: "Real Madrid", competitionCode: "PD" })
  );
});

test("4. administrateur mais requête d'une origine étrangère : refusée (CSRF)", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes({ origin: "https://attaquant.example.net", body: { teamName: "Real Madrid" } });
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(getOrRefreshTeamProfile).not.toHaveBeenCalled();
});

test("5. teamName manquant : 400, jamais un appel à vide", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes({ body: {} });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(getOrRefreshTeamProfile).not.toHaveBeenCalled();
});

test("6. mauvaise méthode (GET) : 405", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes({ method: "GET" });
  await handler(req, res);
  expect(res.statusCode).toBe(405);
});
