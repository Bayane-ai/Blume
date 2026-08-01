/**
 * pages/api/cron/settle-predictions.js — RÈGLEMENT AUTOMATIQUE DE FIN DE MATCH :
 * point d'entrée pour Vercel Cron (voir vercel.json). Sécurisé par CRON_SECRET
 * (convention Vercel officielle) — jamais un endpoint public capable de déclencher
 * des appels API à volonté.
 */
const settleFinishedPredictionsNow = jest.fn(() => Promise.resolve());
jest.mock("../lib/pronosticHistory", () => ({
  settleFinishedPredictionsNow: (...args) => settleFinishedPredictionsNow(...args),
}));

const settleBasketballPredictionsNow = jest.fn(() => Promise.resolve());
let basketballApiKey = null;
jest.mock("../lib/sports/basketball/pronosticHistory", () => ({
  settleFinishedPredictionsNow: (...args) => settleBasketballPredictionsNow(...args),
  getBasketballApiKey: () => basketballApiKey,
}));

const settleTennisPredictionsNow = jest.fn(() => Promise.resolve());
let tennisApiKey = null;
jest.mock("../lib/sports/tennis/pronosticHistory", () => ({
  settleFinishedPredictionsNow: (...args) => settleTennisPredictionsNow(...args),
  getTennisApiKey: () => tennisApiKey,
}));

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

beforeEach(() => {
  jest.resetModules();
  settleFinishedPredictionsNow.mockClear();
  settleBasketballPredictionsNow.mockClear();
  settleTennisPredictionsNow.mockClear();
  basketballApiKey = null;
  tennisApiKey = null;
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.FOOTBALL_DATA_TOKEN = "test-token";
});

afterAll(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_TOKEN === undefined) delete process.env.FOOTBALL_DATA_TOKEN;
  else process.env.FOOTBALL_DATA_TOKEN = ORIGINAL_TOKEN;
});

test("CRON_SECRET non configuré : refusé (500), jamais un endpoint ouvert par erreur", async () => {
  delete process.env.CRON_SECRET;
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: {} }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(settleFinishedPredictionsNow).not.toHaveBeenCalled();
});

test("sans en-tête Authorization : refusé (401)", async () => {
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: {} }, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(settleFinishedPredictionsNow).not.toHaveBeenCalled();
});

test("mauvais secret : refusé (401)", async () => {
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer mauvais-secret" } }, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(settleFinishedPredictionsNow).not.toHaveBeenCalled();
});

test("bon secret (celui envoyé automatiquement par Vercel Cron) : déclenche un vrai balayage complet", async () => {
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer test-cron-secret" } }, res);
  expect(settleFinishedPredictionsNow).toHaveBeenCalledWith("test-token", undefined);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body).toEqual({ ok: true });
});

test("token football-data.org manquant : erreur claire, jamais un balayage silencieusement inopérant", async () => {
  delete process.env.FOOTBALL_DATA_TOKEN;
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer test-cron-secret" } }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(settleFinishedPredictionsNow).not.toHaveBeenCalled();
});

test("clé basket configurée : balayage basket ET football déclenchés indépendamment", async () => {
  basketballApiKey = "basket-key";
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer test-cron-secret" } }, res);
  expect(settleFinishedPredictionsNow).toHaveBeenCalledWith("test-token", undefined);
  expect(settleBasketballPredictionsNow).toHaveBeenCalledWith("basket-key");
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body).toEqual({ ok: true });
});

test("token football manquant mais clé basket présente : le basket est quand même réglé (jamais bloqué par l'autre sport)", async () => {
  delete process.env.FOOTBALL_DATA_TOKEN;
  basketballApiKey = "basket-key";
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer test-cron-secret" } }, res);
  expect(settleFinishedPredictionsNow).not.toHaveBeenCalled();
  expect(settleBasketballPredictionsNow).toHaveBeenCalledWith("basket-key");
  expect(res.status).toHaveBeenCalledWith(200);
});

test("le balayage basket échoue : erreur renvoyée, sans empêcher le balayage football d'avoir eu lieu", async () => {
  basketballApiKey = "basket-key";
  settleBasketballPredictionsNow.mockRejectedValueOnce(new Error("boom basket"));
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer test-cron-secret" } }, res);
  expect(settleFinishedPredictionsNow).toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.body.error).toContain("basketball");
});

test("clé tennis configurée : balayage tennis ET football déclenchés indépendamment", async () => {
  tennisApiKey = "tennis-key";
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer test-cron-secret" } }, res);
  expect(settleFinishedPredictionsNow).toHaveBeenCalledWith("test-token", undefined);
  expect(settleTennisPredictionsNow).toHaveBeenCalledWith("tennis-key");
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body).toEqual({ ok: true });
});

test("le balayage tennis échoue : erreur renvoyée, sans empêcher les autres sports d'avoir été réglés", async () => {
  basketballApiKey = "basket-key";
  tennisApiKey = "tennis-key";
  settleTennisPredictionsNow.mockRejectedValueOnce(new Error("boom tennis"));
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer test-cron-secret" } }, res);
  expect(settleFinishedPredictionsNow).toHaveBeenCalled();
  expect(settleBasketballPredictionsNow).toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.body.error).toContain("tennis");
});

test("aucune clé API du tout (football/basket/tennis) : erreur explicite, aucun balayage", async () => {
  delete process.env.FOOTBALL_DATA_TOKEN;
  const { default: handler } = await import("../pages/api/cron/settle-predictions.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer test-cron-secret" } }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(settleFinishedPredictionsNow).not.toHaveBeenCalled();
  expect(settleBasketballPredictionsNow).not.toHaveBeenCalled();
  expect(settleTennisPredictionsNow).not.toHaveBeenCalled();
});
