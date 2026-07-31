/**
 * pages/api/pronostic-history.js — multi-sport bloc 4 : bascule vers l'historique
 * basket (lib/sports/basketball/pronosticHistory.js) quand `sport=basketball`,
 * football par défaut (comportement inchangé pour tout appel existant).
 */
jest.mock("../lib/pronosticHistory", () => ({ listAndMaintainHistory: jest.fn(() => Promise.resolve([{ match_id: "1", sport: "football" }])) }));
jest.mock("../lib/sports/basketball/pronosticHistory", () => ({
  listAndMaintainHistory: jest.fn(() => Promise.resolve([{ match_id: "bk-1", sport: "basketball" }])),
  getBasketballApiKey: jest.fn(() => "basket-key"),
}));

const { listAndMaintainHistory: footballList } = require("../lib/pronosticHistory");
const { listAndMaintainHistory: basketballList } = require("../lib/sports/basketball/pronosticHistory");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  footballList.mockClear();
  basketballList.mockClear();
});

test("sans paramètre sport : historique football (comportement inchangé)", async () => {
  const { default: handler } = await import("../pages/api/pronostic-history.js");
  const res = mockRes();
  await handler({ query: { status: "success" } }, res);
  expect(footballList).toHaveBeenCalled();
  expect(basketballList).not.toHaveBeenCalled();
  expect(res.body.items).toEqual([{ match_id: "1", sport: "football" }]);
});

test("sport=basketball : historique basket, jamais mélangé au football", async () => {
  const { default: handler } = await import("../pages/api/pronostic-history.js");
  const res = mockRes();
  await handler({ query: { status: "success", sport: "basketball" } }, res);
  expect(basketballList).toHaveBeenCalled();
  expect(footballList).not.toHaveBeenCalled();
  expect(res.body.items).toEqual([{ match_id: "bk-1", sport: "basketball" }]);
});

test("sport=basketball transmet la clé API basket, pas de token football-data", async () => {
  const { default: handler } = await import("../pages/api/pronostic-history.js");
  const res = mockRes();
  await handler({ query: { status: "failure", sport: "basketball" } }, res);
  expect(basketballList).toHaveBeenCalledWith("failure", "basket-key");
});
