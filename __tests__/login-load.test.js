/**
 * pages/api/auth/login.js sous charge (voir PROMPT : "au moins 2000 emails
 * différents par jour, et un même email doit pouvoir se connecter autant de fois
 * qu'il veut d'affilée, sans aucun blocage") :
 *   1. 50 connexions consécutives avec LE MÊME email -> aucun blocage, jamais 429.
 *   2. 50 connexions avec 50 emails distincts -> aucun blocage, jamais 429, chaque
 *      email obtient un compte isolé.
 *   3. 2000 emails distincts (volume réaliste d'une journée) -> aucun blocage.
 *
 * La route de connexion n'a plus AUCUNE limitation de débit (ni compteur en
 * mémoire, ni table Supabase, ni cookie/localStorage) : seule reste la
 * vérification d'origine (CSRF), qui n'entre jamais en jeu ici puisque toutes ces
 * requêtes simulent un appel same-origin normal, exactement comme le fait le
 * vrai navigateur depuis /connexion.
 */
import handler from "../pages/api/auth/login";

const profilesByEmail = new Map();

jest.mock("../lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table) => {
      if (table !== "profiles") throw new Error(`table non simulée : ${table}`);
      return {
        upsert: (row) => ({
          select: () => ({
            single: async () => {
              const existing = profilesByEmail.get(row.email);
              const merged = existing
                ? { ...existing, ...row }
                : { id: `profile-${profilesByEmail.size + 1}`, created_at: new Date().toISOString(), ...row };
              profilesByEmail.set(row.email, merged);
              return { data: merged, error: null };
            },
          }),
        }),
        // Appel ACCESSOIRE (voir pages/api/auth/login.js) : met à jour last_login_at,
        // isolé de l'upsert essentiel ci-dessus.
        update: (patch) => ({
          eq: async (col, val) => {
            const row = [...profilesByEmail.values()].find((p) => p[col] === val);
            if (row) Object.assign(row, patch);
            return { error: null };
          },
        }),
      };
    },
  }),
}));

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
    setHeader(k, v) {
      this.headers[k] = v;
    },
    getHeader(k) {
      return this.headers[k];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return { req, res };
}

beforeEach(() => {
  process.env.AUTH_SESSION_SECRET = "secret-de-test-suffisamment-long";
  profilesByEmail.clear();
});

afterAll(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SESSION_SECRET;
  else process.env.AUTH_SESSION_SECRET = ORIGINAL_AUTH_SECRET;
});

test("50 connexions consécutives avec LE MÊME email : toutes réussissent, jamais 429, jamais 'trop de tentatives'", async () => {
  const email = "meme.email@example.com";
  const statusCodes = [];
  const bodies = [];

  for (let i = 0; i < 50; i++) {
    const { req, res } = mockReqRes({ email });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    statusCodes.push(res.statusCode);
    bodies.push(res.body);
  }

  expect(statusCodes).toEqual(Array(50).fill(200));
  expect(bodies.every((b) => b?.ok === true)).toBe(true);
  expect(statusCodes.some((c) => c === 429)).toBe(false);
  expect(JSON.stringify(bodies)).not.toMatch(/tentative/i);

  // Un seul compte pour cet email, retrouvé (pas recréé) à chaque connexion.
  expect(profilesByEmail.size).toBe(1);
});

test("50 connexions avec 50 emails DISTINCTS : toutes réussissent, jamais 429, comptes isolés", async () => {
  const TOTAL = 50;
  const statusCodes = [];

  for (let i = 0; i < TOTAL; i++) {
    const { req, res } = mockReqRes({ email: `distinct${i}@example.com` });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    statusCodes.push(res.statusCode);
  }

  expect(statusCodes).toEqual(Array(TOTAL).fill(200));
  expect(profilesByEmail.size).toBe(TOTAL);
});

test("200 connexions consécutives avec 200 emails différents : toutes réussissent, aucun message de limitation", async () => {
  const TOTAL = 200;
  const statusCodes = [];
  const bodies = [];

  for (let i = 0; i < TOTAL; i++) {
    const { req, res } = mockReqRes({ email: `compte${i}@example.com` });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    statusCodes.push(res.statusCode);
    bodies.push(res.body);
  }

  expect(statusCodes).toEqual(Array(TOTAL).fill(200));
  expect(bodies.every((b) => b?.ok === true)).toBe(true);
  expect(statusCodes.some((c) => c === 429)).toBe(false);
  expect(JSON.stringify(bodies)).not.toMatch(/trop de tentatives|réessaie dans quelques minutes/i);
  expect(profilesByEmail.size).toBe(TOTAL);
});

test("2000 emails distincts (volume d'une journée) : aucune 429, aucun email bloqué", async () => {
  const TOTAL = 2000;
  const statusCodes = [];

  for (let i = 0; i < TOTAL; i++) {
    const { req, res } = mockReqRes({ email: `utilisateur${i}@example.com` });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    statusCodes.push(res.statusCode);
  }

  const count429 = statusCodes.filter((c) => c === 429).length;
  expect(count429).toBe(0);
  expect(statusCodes.filter((c) => c === 200).length).toBe(TOTAL);
  expect(profilesByEmail.size).toBe(TOTAL);
}, 60000);

test("50 emails DIFFÉRENTS puis 50 fois LE MÊME email, à la suite (un seul scénario, dans cet ordre précis) : aucune ne doit échouer, aucun message de limitation n'apparaît", async () => {
  const statusCodes = [];
  const bodies = [];

  for (let i = 0; i < 50; i++) {
    const { req, res } = mockReqRes({ email: `sequence${i}@example.com` });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    statusCodes.push(res.statusCode);
    bodies.push(res.body);
  }

  const repeatedEmail = "repetee@example.com";
  for (let i = 0; i < 50; i++) {
    const { req, res } = mockReqRes({ email: repeatedEmail });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    statusCodes.push(res.statusCode);
    bodies.push(res.body);
  }

  expect(statusCodes).toEqual(Array(100).fill(200));
  expect(bodies.every((b) => b?.ok === true)).toBe(true);
  expect(statusCodes.some((c) => c === 429)).toBe(false);
  const allBodiesText = JSON.stringify(bodies);
  expect(allBodiesText).not.toMatch(/trop de tentatives/i);
  expect(allBodiesText).not.toMatch(/réessaie dans quelques minutes/i);
});
