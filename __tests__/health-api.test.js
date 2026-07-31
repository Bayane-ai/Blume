/**
 * pages/api/health.js — anti-pause Supabase : vérification manuelle équivalente au
 * workflow programmé .github/workflows/supabase-keepalive.yml. Une requête réelle
 * (mockée ici) vers public.profiles, une seule colonne, une seule ligne.
 */
const selectMock = jest.fn();
const limitMock = jest.fn();

jest.mock("../lib/supabaseAnon", () => ({
  supabaseAnon: {
    from: jest.fn(() => ({ select: selectMock })),
  },
}));

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  selectMock.mockReturnValue({ limit: limitMock });
});

test("la base répond normalement : 200 { ok: true }", async () => {
  limitMock.mockResolvedValue({ data: [{ id: "abc" }], error: null });
  const { default: handler } = await import("../pages/api/health.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.body).toEqual({ ok: true });
  // Une seule colonne, une seule ligne — jamais toute la table.
  expect(selectMock).toHaveBeenCalledWith("id");
  expect(limitMock).toHaveBeenCalledWith(1);
});

test("Supabase renvoie une erreur : 502, jamais un faux 200", async () => {
  limitMock.mockResolvedValue({ data: null, error: { message: "relation \"profiles\" does not exist" } });
  const { default: handler } = await import("../pages/api/health.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.status).toHaveBeenCalledWith(502);
  expect(res.body.ok).toBe(false);
});

test("la requête réseau échoue (exception) : 502, jamais un crash", async () => {
  limitMock.mockRejectedValue(new Error("fetch failed"));
  const { default: handler } = await import("../pages/api/health.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.status).toHaveBeenCalledWith(502);
  expect(res.body.ok).toBe(false);
});
