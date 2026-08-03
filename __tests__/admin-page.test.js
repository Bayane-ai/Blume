/**
 * pages/admin.js — le contrôle d'accès est fait ENTIÈREMENT côté serveur
 * (getServerSideProps), avant même que la page n'atteigne le navigateur : un
 * visiteur qui n'est pas l'administrateur reçoit un vrai 403 HTTP (jamais 404, jamais
 * une redirection qui laisserait deviner que la page existe pour se connecter).
 */
import { getServerSideProps } from "../pages/admin";

let mockSession = null;
jest.mock("../lib/session", () => ({
  getSession: () => mockSession,
}));

const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function mockContext() {
  const headers = {};
  const res = {
    statusCode: 200,
    ended: false,
    endedBody: null,
    setHeader(k, v) { headers[k] = v; },
    end(body) { this.ended = true; this.endedBody = body; },
  };
  return { req: { headers: {}, cookies: {} }, res, headers };
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  mockSession = null;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
});

test("visiteur non connecté : réponse 403, message générique, page jamais rendue", async () => {
  const ctx = mockContext();
  await getServerSideProps(ctx);
  expect(ctx.res.statusCode).toBe(403);
  expect(ctx.res.ended).toBe(true);
  expect(ctx.res.endedBody).toBe("Non autorisé");
});

test("compte connecté mais pas l'administrateur : 403", async () => {
  mockSession = { id: "quelquun-dautre", email: "quelquun@example.com" };
  const ctx = mockContext();
  await getServerSideProps(ctx);
  expect(ctx.res.statusCode).toBe(403);
  expect(ctx.res.ended).toBe(true);
});

test("l'administrateur : accède réellement à la page (props renvoyées, pas de 403)", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const ctx = mockContext();
  const result = await getServerSideProps(ctx);
  expect(ctx.res.ended).toBe(false);
  expect(ctx.res.statusCode).toBe(200);
  expect(result.props.adminEmail).toBe("admin@example.com");
});

test("l'administrateur reçoit la consommation API du jour pour chaque sport suivi (football, basketball)", async () => {
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const ctx = mockContext();
  const result = await getServerSideProps(ctx);
  // Aucun Supabase mocké dans ce test : chaque snapshot retombe honnêtement sur des
  // valeurs "inconnues" (jamais une exception qui ferait planter la page admin) —
  // seule la PRÉSENCE et la liste des sports sont vérifiées ici.
  expect(result.props.quotaSnapshots.map((s) => s.sport)).toEqual(["football", "basketball"]);
});

test("ADMIN_EMAIL non définie : 403 même pour une session qui y ressemblerait", async () => {
  delete process.env.ADMIN_EMAIL;
  mockSession = { id: "user-admin", email: "admin@example.com" };
  const ctx = mockContext();
  await getServerSideProps(ctx);
  expect(ctx.res.statusCode).toBe(403);
});
