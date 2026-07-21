/**
 * pages/api/combo-history.js — POST enregistre les combinés fraîchement générés,
 * GET renvoie le taux de réussite par niveau de risque + la progression (statut
 * global + résultat de chaque sélection) des combinés actuellement affichés (voir
 * lib/comboHistory.js).
 */
jest.mock("../lib/comboHistory", () => ({
  saveComboPredictions: jest.fn(() => Promise.resolve()),
  maintainAndGetComboStats: jest.fn(() => Promise.resolve({ successRates: { faible: { won: 2, total: 3, pct: 66.7 } }, progress: { a: { status: "success", legResults: { 1: true } } } })),
}));

const { saveComboPredictions, maintainAndGetComboStats } = require("../lib/comboHistory");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  saveComboPredictions.mockClear();
  maintainAndGetComboStats.mockClear();
});

test("POST : enregistre les combinés reçus, répond {saved:true}", async () => {
  const { default: handler } = await import("../pages/api/combo-history.js");
  const res = mockRes();
  const combos = [{ id: "combo-1" }];
  await handler({ method: "POST", body: { combos } }, res);

  expect(saveComboPredictions).toHaveBeenCalledWith(combos);
  expect(res.body).toEqual({ saved: true });
});

test("POST sans tableau \"combos\" : 400, jamais un plantage", async () => {
  const { default: handler } = await import("../pages/api/combo-history.js");
  const res = mockRes();
  await handler({ method: "POST", body: {} }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(saveComboPredictions).not.toHaveBeenCalled();
});

test("GET : renvoie le taux de réussite et le statut des combinés demandés (ids séparés par des virgules)", async () => {
  const { default: handler } = await import("../pages/api/combo-history.js");
  const res = mockRes();
  await handler({ method: "GET", query: { ids: "a,b,c" } }, res);

  expect(maintainAndGetComboStats).toHaveBeenCalledWith(["a", "b", "c"], undefined, undefined);
  expect(res.body.successRates.faible).toEqual({ won: 2, total: 3, pct: 66.7 });
  expect(res.body.progress).toEqual({ a: { status: "success", legResults: { 1: true } } });
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", expect.stringContaining("s-maxage"));
});

test("GET sans paramètre \"ids\" : liste vide, jamais un plantage", async () => {
  const { default: handler } = await import("../pages/api/combo-history.js");
  const res = mockRes();
  await handler({ method: "GET", query: {} }, res);

  expect(maintainAndGetComboStats).toHaveBeenCalledWith([], undefined, undefined);
});

test("erreur inattendue : 500 avec des objets vides, jamais un plantage", async () => {
  maintainAndGetComboStats.mockRejectedValueOnce(new Error("boom"));
  const { default: handler } = await import("../pages/api/combo-history.js");
  const res = mockRes();
  await handler({ method: "GET", query: {} }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.body.successRates).toEqual({});
  expect(res.body.progress).toEqual({});
});
