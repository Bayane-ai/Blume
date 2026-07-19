/**
 * Vérifie /api/competition-standings : renvoie le vrai classement (déjà mis en cache
 * pour les pronostics), avec un tableau vide (pas d'erreur) quand une compétition n'a
 * pas de classement structuré (ex : phase à élimination directe).
 */
const TOKEN = "test-token";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
});

test("renvoie le classement réel d'une compétition", async () => {
  const table = [
    { position: 1, points: 25, form: "WWWWW", playedGames: 10, goalsFor: 20, goalsAgainst: 10, won: 8, draw: 1, lost: 1, team: { id: 100, name: "Arsenal FC", crest: "" } },
  ];
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table }] }) })
  );

  const { default: handler } = await import("../pages/api/competition-standings.js");
  const res = mockRes();
  await handler({ query: { code: "PL" } }, res);

  expect(res.body.table).toHaveLength(1);
  expect(res.body.table[0].team.name).toBe("Arsenal FC");
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", expect.stringContaining("s-maxage"));
});

test("compétition inconnue : erreur claire, pas de crash", async () => {
  const { default: handler } = await import("../pages/api/competition-standings.js");
  const res = mockRes();
  await handler({ query: { code: "XX" } }, res);

  expect(res.status).toHaveBeenCalledWith(400);
});

test("pas de classement structuré (ex : élimination directe) : tableau vide, pas d'erreur", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) })
  );

  const { default: handler } = await import("../pages/api/competition-standings.js");
  const res = mockRes();
  await handler({ query: { code: "WC" } }, res);

  expect(res.body.table).toEqual([]);
  expect(res.body.error).toBeUndefined();
});
