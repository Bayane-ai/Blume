/**
 * lib/session.js — Partie 1 du système de cookies (voir PROMPT "Cookie de session") :
 * vérifie que le cookie posé porte EXACTEMENT les attributs demandés (httpOnly,
 * secure, sameSite=lax, path=/, maxAge=30 jours), que la déconnexion l'efface bien,
 * et que le jeton signé résiste à une altération.
 */
import { createSessionToken, verifySessionToken, setSessionCookie, clearSessionCookie, COOKIE_NAME } from "../lib/session";

const SECRET = "un-secret-de-test-suffisamment-long";
const THIRTY_DAYS_SECONDS = 30 * 24 * 3600;

function mockRes() {
  const headers = {};
  return {
    getHeader: (k) => headers[k],
    setHeader: (k, v) => {
      headers[k] = v;
    },
    _headers: headers,
  };
}

test("le nom du cookie de session est blume_session", () => {
  expect(COOKIE_NAME).toBe("blume_session");
});

test("setSessionCookie pose un cookie httpOnly, secure, sameSite=lax, path=/, 30 jours", () => {
  const res = mockRes();
  const token = createSessionToken({ id: "user-1", email: "a@example.com" }, SECRET);
  setSessionCookie(res, token);

  const setCookie = res._headers["Set-Cookie"];
  expect(Array.isArray(setCookie)).toBe(true);
  const cookieString = setCookie[0];

  expect(cookieString).toContain(`${COOKIE_NAME}=${token}`);
  expect(cookieString).toMatch(/;\s*HttpOnly/i);
  expect(cookieString).toMatch(/;\s*Secure/i);
  expect(cookieString).toMatch(/;\s*SameSite=Lax/i);
  expect(cookieString).toMatch(/;\s*Path=\//i);
  expect(cookieString).toMatch(new RegExp(`Max-Age=${THIRTY_DAYS_SECONDS}\\b`));
});

test("clearSessionCookie efface le cookie (valeur vide, Max-Age=0) en gardant les mêmes attributs", () => {
  const res = mockRes();
  clearSessionCookie(res);

  const cookieString = res._headers["Set-Cookie"][0];
  expect(cookieString).toMatch(new RegExp(`^${COOKIE_NAME}=;`));
  expect(cookieString).toMatch(/Max-Age=0\b/);
  expect(cookieString).toMatch(/;\s*HttpOnly/i);
  expect(cookieString).toMatch(/;\s*Secure/i);
  expect(cookieString).toMatch(/;\s*SameSite=Lax/i);
});

test("un jeton valide se vérifie et renvoie { id, email }", () => {
  const token = createSessionToken({ id: "user-42", email: "quelquun@example.com" }, SECRET);
  expect(verifySessionToken(token, SECRET)).toEqual({ id: "user-42", email: "quelquun@example.com" });
});

test("un jeton altéré (signature invalide) est rejeté", () => {
  const token = createSessionToken({ id: "user-42", email: "quelquun@example.com" }, SECRET);
  const tampered = token.slice(0, -2) + "xx";
  expect(verifySessionToken(tampered, SECRET)).toBeNull();
});

test("un jeton vérifié avec le mauvais secret est rejeté", () => {
  const token = createSessionToken({ id: "user-42", email: "quelquun@example.com" }, SECRET);
  expect(verifySessionToken(token, "autre-secret")).toBeNull();
});

test("un jeton expiré est rejeté", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const dateSpy = jest.spyOn(Date, "now").mockReturnValue((nowSeconds - THIRTY_DAYS_SECONDS - 10) * 1000);
  const token = createSessionToken({ id: "user-42", email: "quelquun@example.com" }, SECRET);
  dateSpy.mockRestore();
  expect(verifySessionToken(token, SECRET)).toBeNull();
});
