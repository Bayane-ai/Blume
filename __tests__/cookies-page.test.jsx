/**
 * @jest-environment jsdom
 *
 * pages/cookies.js (voir PROMPT Partie 3, lien "En savoir plus") : page PUBLIQUE,
 * accessible sans connexion — n'utilise volontairement PAS lib/useRequireAuth.js.
 */
import { render, screen } from "@testing-library/react";
import CookiesPage from "../pages/cookies";

test("se rend sans aucune session ni appel réseau (page publique, pas de useRequireAuth)", () => {
  render(<CookiesPage />);
  expect(screen.getByRole("heading", { name: /les cookies utilisés par blume/i })).toBeInTheDocument();
});

test("détaille les 3 cookies strictement nécessaires (session, préférences, consentement)", () => {
  render(<CookiesPage />);
  expect(screen.getByText(/blume_session/)).toBeInTheDocument();
  expect(screen.getByText(/blume_prefs/)).toBeInTheDocument();
  expect(screen.getByText(/blume_consent/)).toBeInTheDocument();
});

test("indique clairement l'absence de cookies de mesure/publicité", () => {
  render(<CookiesPage />);
  expect(screen.getAllByText(/aucun cookie de mesure d'audience ni de publicité/i).length).toBeGreaterThan(0);
});
