/**
 * @jest-environment jsdom
 *
 * components/CookieBanner.js (voir PROMPT Partie 3) : bandeau affiché à la première
 * visite uniquement, avec "Tout accepter" / "Refuser les cookies non essentiels" /
 * "En savoir plus" -> /cookies. Le choix est mémorisé (blume_consent) et le bandeau
 * ne réapparaît plus ensuite, sauf demande explicite (voir pages/reglages.js).
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import CookieBanner from "../components/CookieBanner";
import { readConsent, requestConsentReset } from "../lib/consentCookie";

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

beforeEach(() => {
  clearCookies();
});

test("première visite (aucun cookie blume_consent) : le bandeau s'affiche", async () => {
  render(<CookieBanner />);
  expect(await screen.findByTestId("cookie-banner")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /tout accepter/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /refuser les cookies non essentiels/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /en savoir plus/i })).toHaveAttribute("href", "/cookies");
});

test("choix déjà enregistré (essential) : le bandeau ne s'affiche PAS", () => {
  document.cookie = "blume_consent=essential; Path=/";
  render(<CookieBanner />);
  expect(screen.queryByTestId("cookie-banner")).not.toBeInTheDocument();
});

test('"Tout accepter" enregistre blume_consent=all et masque le bandeau', async () => {
  render(<CookieBanner />);
  await screen.findByTestId("cookie-banner");

  fireEvent.click(screen.getByRole("button", { name: /tout accepter/i }));

  expect(readConsent()).toBe("all");
  await waitFor(() => expect(screen.queryByTestId("cookie-banner")).not.toBeInTheDocument());
});

test('"Refuser les cookies non essentiels" enregistre blume_consent=essential et masque le bandeau', async () => {
  render(<CookieBanner />);
  await screen.findByTestId("cookie-banner");

  fireEvent.click(screen.getByRole("button", { name: /refuser les cookies non essentiels/i }));

  expect(readConsent()).toBe("essential");
  await waitFor(() => expect(screen.queryByTestId("cookie-banner")).not.toBeInTheDocument());
});

test("après un choix, remonter le composant (nouvelle page) ne réaffiche PAS le bandeau", async () => {
  const { unmount } = render(<CookieBanner />);
  fireEvent.click(await screen.findByRole("button", { name: /tout accepter/i }));
  unmount();

  render(<CookieBanner />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByTestId("cookie-banner")).not.toBeInTheDocument();
});

test("requestConsentReset() (depuis les réglages) fait réapparaître le bandeau sans recharger la page", async () => {
  document.cookie = "blume_consent=all; Path=/";
  render(<CookieBanner />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByTestId("cookie-banner")).not.toBeInTheDocument();

  requestConsentReset();

  expect(await screen.findByTestId("cookie-banner")).toBeInTheDocument();
});
