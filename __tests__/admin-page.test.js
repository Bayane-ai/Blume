/**
 * pages/admin.js — le contrôle d'accès est fait ENTIÈREMENT côté serveur
 * (getServerSideProps), avant même que la page n'atteigne le navigateur : un
 * visiteur qui n'est pas le propriétaire reçoit un vrai 403 HTTP (jamais 404, jamais
 * une redirection qui laisserait deviner que la page existe pour se connecter).
 */
import { getServerSideProps } from "../pages/admin";

let mockUser = null;
jest.mock("../lib/supabaseServer", () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
  }),
}));

const ORIGINAL_OWNER_EMAIL = process.env.OWNER_EMAIL;

function mockContext() {
  const headers = {};
  const res = {
    statusCode: 200,
    ended: false,
    endedBody: null,
    setHeader(k, v) { headers[k] = v; },
    end(body) { this.ended = true; this.endedBody = body; },
  };
  return { req: { headers: {} }, res, headers };
}

beforeEach(() => {
  process.env.OWNER_EMAIL = "owner@example.com";
  mockUser = null;
});

afterAll(() => {
  if (ORIGINAL_OWNER_EMAIL === undefined) delete process.env.OWNER_EMAIL;
  else process.env.OWNER_EMAIL = ORIGINAL_OWNER_EMAIL;
});

test("visiteur non connecté : réponse 403, message générique, page jamais rendue", async () => {
  const ctx = mockContext();
  await getServerSideProps(ctx);
  expect(ctx.res.statusCode).toBe(403);
  expect(ctx.res.ended).toBe(true);
  expect(ctx.res.endedBody).toBe("Non autorisé");
});

test("compte connecté mais pas le propriétaire : 403", async () => {
  mockUser = { id: "quelquun-dautre", email: "quelquun@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  const ctx = mockContext();
  await getServerSideProps(ctx);
  expect(ctx.res.statusCode).toBe(403);
  expect(ctx.res.ended).toBe(true);
});

test("le propriétaire : accède réellement à la page (props renvoyées, pas de 403)", async () => {
  mockUser = { id: "user-owner", email: "owner@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  const ctx = mockContext();
  const result = await getServerSideProps(ctx);
  expect(ctx.res.ended).toBe(false);
  expect(ctx.res.statusCode).toBe(200);
  expect(result.props.ownerEmail).toBe("owner@example.com");
});

test("email correspondant mais NON vérifié : 403 (jamais une simple déclaration d'email)", async () => {
  mockUser = { id: "user-owner", email: "owner@example.com", email_confirmed_at: null };
  const ctx = mockContext();
  await getServerSideProps(ctx);
  expect(ctx.res.statusCode).toBe(403);
});

test("OWNER_EMAIL non définie : 403 même pour une session qui y ressemblerait", async () => {
  delete process.env.OWNER_EMAIL;
  mockUser = { id: "user-owner", email: "owner@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  const ctx = mockContext();
  await getServerSideProps(ctx);
  expect(ctx.res.statusCode).toBe(403);
});
