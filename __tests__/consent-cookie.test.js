/**
 * @jest-environment jsdom
 *
 * lib/consentCookie.js — cookie "blume_consent" (voir PROMPT Partie 3) : "all" ou
 * "essential", 6 mois, jamais autre chose.
 */
import {
  readConsent,
  writeConsent,
  clearConsent,
  hasNonEssentialConsent,
  requestConsentReset,
  CONSENT_RESET_EVENT,
  COOKIE_NAME,
} from "../lib/consentCookie";

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

beforeEach(() => {
  clearCookies();
});

test("nom du cookie : blume_consent", () => {
  expect(COOKIE_NAME).toBe("blume_consent");
});

test("aucun cookie posé : readConsent() renvoie null (le bandeau doit s'afficher)", () => {
  expect(readConsent()).toBeNull();
  expect(hasNonEssentialConsent()).toBe(false);
});

test('writeConsent("all") : lu ensuite comme "all", hasNonEssentialConsent() vrai', () => {
  writeConsent("all");
  expect(readConsent()).toBe("all");
  expect(hasNonEssentialConsent()).toBe(true);
});

test('writeConsent("essential") : lu ensuite comme "essential", hasNonEssentialConsent() faux', () => {
  writeConsent("essential");
  expect(readConsent()).toBe("essential");
  expect(hasNonEssentialConsent()).toBe(false);
});

test("une valeur autre que all/essential est ignorée à l'écriture", () => {
  writeConsent("tout-sauf-ca");
  expect(readConsent()).toBeNull();
});

test("clearConsent() efface le cookie : readConsent() redevient null", () => {
  writeConsent("all");
  clearConsent();
  expect(readConsent()).toBeNull();
});

test("requestConsentReset() efface le cookie ET émet CONSENT_RESET_EVENT", () => {
  writeConsent("all");
  const listener = jest.fn();
  window.addEventListener(CONSENT_RESET_EVENT, listener);

  requestConsentReset();

  expect(readConsent()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener(CONSENT_RESET_EVENT, listener);
});
