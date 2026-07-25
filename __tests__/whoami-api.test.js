/**
 * pages/api/whoami.js — route de LECTURE seule : renvoie uniquement un booléen
 * (isOwner), jamais OWNER_ID/OWNER_EMAIL ni aucune information sur l'identité du
 * propriétaire pour qui que ce soit d'autre.
 */
import handler from "../pages/api/whoami";

let mockUser = null;
jest.mock("../lib/supabaseServer", () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
  }),
}));

const ORIGINAL_OWNER_ID = process.env.OWNER_ID;

function mockReqRes() {
  const req = { headers: {}, socket: {} };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  process.env.OWNER_ID = "user-owner";
  mockUser = null;
});

afterAll(() => {
  if (ORIGINAL_OWNER_ID === undefined) delete process.env.OWNER_ID;
  else process.env.OWNER_ID = ORIGINAL_OWNER_ID;
});

test("visiteur non connecté : isOwner=false", async () => {
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.body).toEqual({ isOwner: false });
});

test("compte connecté mais pas le propriétaire : isOwner=false", async () => {
  mockUser = { id: "quelquun-dautre", email: "quelquun@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.body).toEqual({ isOwner: false });
});

test("le propriétaire : isOwner=true", async () => {
  mockUser = { id: "user-owner", email: "owner@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(res.body).toEqual({ isOwner: true });
});

test("ne renvoie jamais OWNER_ID/OWNER_EMAIL ni l'email/l'id de la session", async () => {
  process.env.OWNER_EMAIL = "owner@example.com";
  mockUser = { id: "user-owner", email: "owner@example.com" };
  const { req, res } = mockReqRes();
  await handler(req, res);
  expect(JSON.stringify(res.body)).not.toMatch(/user-owner|owner@example\.com/);
  delete process.env.OWNER_EMAIL;
});
