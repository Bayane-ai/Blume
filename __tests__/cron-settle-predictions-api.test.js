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
