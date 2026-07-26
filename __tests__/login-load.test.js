/**
 * pages/api/auth/login.js sous charge (voir PROMPT : "au moins 2000 emails
 * différents par jour, sans jamais afficher 'trop de tentatives'") :
 *   1. 2000 connexions, 2000 emails distincts, 2000 IP distinctes -> AUCUNE 429,
 *      AUCUN message de débit, chaque email obtient bien un compte distinct.
 *   2. Le débit reste actif comme protection anti-abus : une IP UNIQUE qui
 *      dépasse 20 tentatives dans la même minute est, elle, bloquée (429) — la
 *      protection n'a pas disparu, elle ne vise plus que l'abus réel depuis une
 *      seule IP, jamais le volume légitime d'utilisateurs distincts.
 *   3. Aucun compteur global partagé : une IP qui vient d'être bloquée n'affecte
 *      en rien les autres IP.
 */
import handler from "../pages/api/auth/login";
import { __resetRateLimitForTests } from "../lib/security/rateLimit";

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
      };
    },
  }),
}));

const ORIGINAL_AUTH_SECRET = process.env.AUTH_SESSION_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function mockReqRes({ method = "POST", email, ip, origin = "https://blume.example.com", host = "blume.example.com" } = {}) {
  const req = {
    method,
    headers: { origin, host, "x-forwarded-for": ip },
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
  __resetRateLimitForTests();
});

afterAll(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SESSION_SECRET;
  else process.env.AUTH_SESSION_SECRET = ORIGINAL_AUTH_SECRET;
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

test("2000 emails distincts depuis 2000 IP distinctes : aucune 429, aucun email bloqué", async () => {
  const TOTAL = 2000;
  const statusCodes = [];
  const rateLimitedEmails = [];

  for (let i = 0; i < TOTAL; i++) {
    const email = `utilisateur${i}@example.com`;
    const ip = `10.${Math.floor(i / 65000)}.${Math.floor(i / 255) % 255}.${i % 255}`;
    const { req, res } = mockReqRes({ email, ip });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    statusCodes.push(res.statusCode);
    if (res.statusCode === 429) rateLimitedEmails.push(email);
  }

  const count429 = statusCodes.filter((c) => c === 429).length;
  expect(count429).toBe(0);
  expect(rateLimitedEmails).toEqual([]);

  const count200 = statusCodes.filter((c) => c === 200).length;
  expect(count200).toBe(TOTAL);

  // Chaque email distinct a bien produit un compte distinct, isolé des autres.
  expect(profilesByEmail.size).toBe(TOTAL);
  const ids = new Set([...profilesByEmail.values()].map((p) => p.id));
  expect(ids.size).toBe(TOTAL);
}, 60000);

test("2001 emails distincts sur la MÊME IP dans la même minute : 429 seulement au-delà de 20 (protection anti-abus toujours active)", async () => {
  const ip = "203.0.113.42";
  const results = [];
  for (let i = 0; i < 25; i++) {
    const { req, res } = mockReqRes({ email: `abus${i}@example.com`, ip });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
    results.push(res.statusCode);
  }
  expect(results.slice(0, 20)).toEqual(Array(20).fill(200));
  expect(results.slice(20)).toEqual(Array(5).fill(429));
});

test("une IP bloquée n'affecte jamais les autres IP (aucun compteur global partagé)", async () => {
  const abusiveIp = "198.51.100.7";
  for (let i = 0; i < 25; i++) {
    const { req, res } = mockReqRes({ email: `abus2-${i}@example.com`, ip: abusiveIp });
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res);
  }
  // L'IP ci-dessus est maintenant bloquée (au-delà de 20/min) ; une IP différente,
  // elle, doit passer sans aucun problème.
  const { req, res } = mockReqRes({ email: "victime-collaterale@example.com", ip: "9.9.9.9" });
  await handler(req, res);
  expect(res.statusCode).toBe(200);
});
