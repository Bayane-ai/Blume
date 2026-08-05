/**
 * pages/api/sportscore.js — relais same-origin vers l'API publique SportScore, utilisé
 * automatiquement quand l'appel direct navigateur est refusé (CORS, blocage réseau).
 * Le visiteur voit les matchs sans jamais cliquer ni quitter le site.
 */
function mockRes() {
  const res = { headers: {} };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  return res;
}

beforeEach(() => { jest.resetModules(); });
afterEach(() => { delete global.fetch; });

async function callHandler(query) {
  const { default: handler } = await import("../pages/api/sportscore.js");
  const res = mockRes();
  await handler({ query }, res);
  return res;
}

test("relaie la réponse SportScore pour un sport valide, sans aucune clé API", async () => {
  const payload = { matches: [{ id: 1 }] };
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));

  const res = await callHandler({ sport: "football", limit: "50" });

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual(payload);
  const url = global.fetch.mock.calls[0][0];
  expect(url).toBe("https://sportscore.com/api/widget/matches/?sport=football&limit=50");
  expect(url).not.toMatch(/key|token/i);
});

test.each(["football", "tennis", "basketball"])("accepte le sport %s", async (sport) => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) }));
  const res = await callHandler({ sport });
  expect(res.statusCode).toBe(200);
  expect(global.fetch.mock.calls[0][0]).toContain(`sport=${sport}`);
});

test("refuse un sport hors liste blanche : ne relaie jamais une adresse arbitraire", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("aucun appel réseau attendu")));
  const res = await callHandler({ sport: "../../etc/passwd" });
  expect(res.statusCode).toBe(400);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("borne limit sur le plafond réel de l'API (1..50)", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  await callHandler({ sport: "tennis", limit: "9999" });
  expect(global.fetch.mock.calls[0][0]).toContain("limit=50");
});

test("met en cache 5 min côté CDN : protège le quota partagé (~1000 req/24h/IP côté serveur)", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const res = await callHandler({ sport: "football" });
  expect(res.headers["Cache-Control"]).toContain("s-maxage=300");
});

test("source en erreur : renvoie le vrai code HTTP, jamais un plantage", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("rate limited") }));
  const res = await callHandler({ sport: "football" });
  expect(res.statusCode).toBe(429);
  expect(typeof res.body.error).toBe("string");
});

test("source injoignable : 502 propre, jamais une exception non gérée", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("ENOTFOUND")));
  const res = await callHandler({ sport: "basketball" });
  expect(res.statusCode).toBe(502);
  expect(typeof res.body.error).toBe("string");
});
