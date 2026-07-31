/**
 * @jest-environment jsdom
 *
 * Multi-sport (bloc 0) — même garde-fou que __tests__/all-pages-protected.test.jsx,
 * mais pour le sélecteur de sport : sur CHAQUE page de contenu (Live, Matchs à venir,
 * Combiné Vision, News, Historique, Probabilités réussies, Probabilités échouées), le
 * sélecteur à 3 onglets est présent, football est actif par défaut, et passer sur
 * Basket/Tennis affiche un état de chargement propre — jamais une erreur, jamais une
 * page blanche, jamais de lien mort dans la navigation.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Home from "../pages/index";
import UpcomingMatches from "../pages/a-venir";
import CombineVision from "../pages/combine-vision";
import News from "../pages/news";
import Historique from "../pages/historique";
import ProbabilitesReussies from "../pages/probabilites-reussies";
import ProbabilitesEchouees from "../pages/probabilites-echouees";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { id: "u1", email: "test@example.com" },
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

// Chaque page appelle ses propres routes football — toutes mockées ici pour ne
// jamais planter le rendu football (déjà couvert individuellement par les tests
// dédiés à chaque page), l'objectif ici est uniquement le comportement du sélecteur.
function mockFetch() {
  return jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    if (url.startsWith("/api/matches")) return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    if (url.startsWith("/api/news")) return Promise.resolve({ json: () => Promise.resolve({ articles: [] }) });
    if (url.startsWith("/api/pronostic-history")) return Promise.resolve({ json: () => Promise.resolve({ items: [] }) });
    if (url.startsWith("/api/combo-history")) return Promise.resolve({ json: () => Promise.resolve({ successRates: {}, progress: {} }) });
    if (url.startsWith("/api/search-history")) return Promise.resolve({ json: () => Promise.resolve({ queries: [] }) });
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

// lib/matchHistory.js (page Historique) appelle Supabase directement, pas fetch —
// mocké séparément pour cette page (voir __tests__/match-history-page.test.jsx).
jest.mock("../lib/matchHistory", () => ({
  listMatchHistory: () => Promise.resolve([]),
}));

beforeEach(() => {
  clearCookies();
  global.fetch = mockFetch();
});

const pages = [
  ["Live", Home],
  ["Matchs à venir", UpcomingMatches],
  ["Combiné Vision", CombineVision],
  ["News", News],
  ["Historique", Historique],
  ["Probabilités réussies", ProbabilitesReussies],
  ["Probabilités échouées", ProbabilitesEchouees],
];

describe.each(pages)("%s : sélecteur de sport", (label, Page) => {
  test("football actif par défaut, les 3 onglets sont présents et cliquables, la navigation à 7 liens reste identique", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByTestId("sport-tabs")).toBeInTheDocument());

    expect(screen.getByTestId("sport-tab-football")).toHaveAttribute("aria-selected", "true");

    const nav = screen.getByTestId("main-nav");
    for (const navLabel of ["Live", "Matchs à venir", "Combiné Vision", "News", "Historique", "Probabilités réussies", "Probabilités échouées"]) {
      expect(within(nav).getByText(navLabel)).toBeInTheDocument();
    }
  });

  test("passer sur Basket puis Tennis affiche un état de chargement propre, jamais une erreur ni une page blanche", async () => {
    const { container } = render(<Page />);
    await waitFor(() => expect(screen.getByTestId("sport-tabs")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("sport-tab-basketball"));
    await waitFor(() => expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/erreur/i);
    expect(container.textContent.trim().length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("sport-tab-tennis"));
    await waitFor(() => expect(screen.getByTestId("sport-coming-soon").textContent).toMatch(/Tennis/));
    expect(container.textContent).not.toMatch(/erreur/i);
  });
});
