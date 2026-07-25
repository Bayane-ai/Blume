/**
 * lib/security/rateLimit.js — limite le nombre de requêtes par IP et par route dans
 * une fenêtre glissante, pour freiner le scraping massif / les tentatives répétées.
 */
import { checkRateLimit, __resetRateLimitForTests } from "../lib/security/rateLimit";

function req(ip) {
  return { headers: { "x-forwarded-for": ip }, socket: {} };
}

beforeEach(() => {
  __resetRateLimitForTests();
});

test("autorise jusqu'à la limite, puis refuse", () => {
  const r = req("1.2.3.4");
  for (let i = 0; i < 5; i++) {
    expect(checkRateLimit(r, "test-route", { limit: 5, windowMs: 60_000 })).toBe(true);
  }
  expect(checkRateLimit(r, "test-route", { limit: 5, windowMs: 60_000 })).toBe(false);
});

test("deux IP différentes ont chacune leur propre quota", () => {
  const a = req("1.1.1.1");
  const b = req("2.2.2.2");
  for (let i = 0; i < 3; i++) expect(checkRateLimit(a, "route", { limit: 3, windowMs: 60_000 })).toBe(true);
  expect(checkRateLimit(a, "route", { limit: 3, windowMs: 60_000 })).toBe(false);
  // b n'a encore rien consommé de son propre quota.
  expect(checkRateLimit(b, "route", { limit: 3, windowMs: 60_000 })).toBe(true);
});

test("deux routes différentes ont chacune leur propre quota, même IP", () => {
  const r = req("9.9.9.9");
  for (let i = 0; i < 2; i++) expect(checkRateLimit(r, "route-a", { limit: 2, windowMs: 60_000 })).toBe(true);
  expect(checkRateLimit(r, "route-a", { limit: 2, windowMs: 60_000 })).toBe(false);
  expect(checkRateLimit(r, "route-b", { limit: 2, windowMs: 60_000 })).toBe(true);
});

test("la fenêtre expirée réinitialise le quota", () => {
  const nowSpy = jest.spyOn(Date, "now");
  nowSpy.mockReturnValue(1_000_000);
  const r = req("5.5.5.5");
  expect(checkRateLimit(r, "route", { limit: 1, windowMs: 60_000 })).toBe(true);
  expect(checkRateLimit(r, "route", { limit: 1, windowMs: 60_000 })).toBe(false);

  nowSpy.mockReturnValue(1_000_000 + 60_001); // fenêtre suivante
  expect(checkRateLimit(r, "route", { limit: 1, windowMs: 60_000 })).toBe(true);
  nowSpy.mockRestore();
});
