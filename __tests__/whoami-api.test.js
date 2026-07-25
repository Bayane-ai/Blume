/**
 * pages/api/whoami.js — route de LECTURE seule : renvoie uniquement un booléen
 * (isOwner), jamais ADMIN_EMAIL ni aucune information sur l'identité de
 * l'administrateur pour qui que ce soit d'autre.
 */
import handler from "../pages/api/whoami";

let mockSession = null;
jest.mock("../lib/session", () => ({
  getSession: () => mockSession,
}));

const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function mockReqRes() {
  const req = { headers: {}, socket: {}, cookies: {} };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  mockSession = null;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
});

test("visiteur non connecté : isOwner=false", async () => {
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.body).toEqual({ isOwner: false });
});

test("compte connecté mais pas l'administrateur : isOwner=false", async () => {
  mockSession = { id: "quelquun-dautre", email: "quelquun@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.body).toEqual({ isOwner: false });
});

test("l'administrateur : isOwner=true", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.body).toEqual({ isOwner: true });
});

test("ne renvoie jamais ADMIN_EMAIL ni l'email/l'id de la session", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(JSON.stringify(res.body)).not.toMatch(/user-admin|admin@example\.com/);
});
