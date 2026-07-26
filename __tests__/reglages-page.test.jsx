/**
 * @jest-environment jsdom
 *
 * pages/reglages.js — Partie 2 (thème clair/sombre, mémorisé dans blume_prefs) et
 * Partie 3 (revenir sur le choix de cookies) du système de cookies.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Reglages from "../pages/reglages";
import { readPrefs } from "../lib/prefsCookie";
import { readConsent, writeConsent, CONSENT_RESET_EVENT } from "../lib/consentCookie";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/reglages", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { id: "user-1", email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
}));

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

beforeEach(() => {
  clearCookies();
  document.documentElement.removeAttribute("data-theme");
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }));
});

test("le thème sombre est sélectionné par défaut (aucune préférence enregistrée)", async () => {
  render(<Reglages />);
  const darkBtn = await screen.findByTestId("theme-choice-dark");
  expect(darkBtn).toHaveAttribute("aria-pressed", "true");
});

test('cliquer sur "Clair" applique data-theme="light" et l\'enregistre dans blume_prefs (1 an)', async () => {
  render(<Reglages />);
  fireEvent.click(await screen.findByTestId("theme-choice-light"));

  await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("light"));
  expect(readPrefs().theme).toBe("light");
  expect(screen.getByTestId("theme-choice-light")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("theme-choice-dark")).toHaveAttribute("aria-pressed", "false");
});

test("revenir sur Sombre réapplique data-theme et le cookie", async () => {
  render(<Reglages />);
  fireEvent.click(await screen.findByTestId("theme-choice-light"));
  await waitFor(() => expect(readPrefs().theme).toBe("light"));

  fireEvent.click(screen.getByTestId("theme-choice-dark"));
  await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
  expect(readPrefs().theme).toBe("dark");
});

test("affiche l'état actuel du consentement aux cookies", async () => {
  writeConsent("all");
  render(<Reglages />);
  expect(await screen.findByTestId("consent-status")).toHaveTextContent(/tu as accepté tous les cookies/i);
});

test('"Modifier mes préférences de cookies" efface blume_consent et émet CONSENT_RESET_EVENT (le bandeau réapparaît sans recharger)', async () => {
  writeConsent("essential");
  const listener = jest.fn();
  window.addEventListener(CONSENT_RESET_EVENT, listener);

  render(<Reglages />);
  fireEvent.click(await screen.findByTestId("reopen-cookie-banner"));

  expect(readConsent()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByTestId("consent-status")).toHaveTextContent(/aucun choix enregistré/i));

  window.removeEventListener(CONSENT_RESET_EVENT, listener);
});
