/**
 * @jest-environment jsdom
 *
 * Multi-sport — même garde-fou que __tests__/all-pages-protected.test.jsx, mais pour
 * le sélecteur de sport : sur CHAQUE page de contenu (Live, Matchs à venir, Combiné
 * Vision, News, Historique, Probabilités réussies, Probabilités échouées), le
 * sélecteur à 3 onglets est présent, football est actif par défaut, et la navigation
 * à 7 liens reste identique quel que soit le sport. Basket (bloc 2) ET tennis (bloc 5)
 * ont désormais de VRAIS écrans sur Live et Matchs à venir (voir pages/index.js et
 * pages/a-venir.js) ; les autres pages affichent toujours un état de chargement propre
 * pour ces deux sports — jamais une erreur, jamais une page blanche, jamais de lien
 * mort dans la navigation.
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

// Chaque page appelle ses propres routes football/basket — toutes mockées ici pour ne
// jamais planter le rendu (déjà couvert individuellement par les tests dédiés à
// chaque page), l'objectif ici est uniquement le comportement du sélecteur.
function mockFetch() {
  return jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    if (url.startsWith("/api/matches")) return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    if (url.startsWith("/api/basketball/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    if (url.startsWith("/api/basketball/matches")) return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    if (url.startsWith("/api/tennis/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    if (url.startsWith("/api/tennis/matches")) return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
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
});

// Basket : Live, Matchs à venir (bloc 2) ET désormais Probabilités réussies/échouées
// (bloc 4, voir components/PronosticHistoryPage.js) ont de vrais écrans — plus de
// placeholder sur ces 4 pages.
describe.each([
  ["Live", Home], ["Matchs à venir", UpcomingMatches],
  ["Probabilités réussies", ProbabilitesReussies], ["Probabilités échouées", ProbabilitesEchouees],
])(
  "%s : passer sur Basket affiche un vrai écran, jamais un placeholder",
  (label, Page) => {
    test("aucune erreur, aucune page blanche, aucun placeholder « bientôt disponible »", async () => {
      const { container } = render(<Page />);
      await waitFor(() => expect(screen.getByTestId("sport-tabs")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("sport-tab-basketball"));
      await waitFor(() => expect(screen.getByTestId("sport-tab-basketball")).toHaveAttribute("aria-selected", "true"));
      await waitFor(() => expect(container.textContent).toMatch(/Basket/));
      expect(screen.queryByTestId("sport-coming-soon")).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(/erreur/i);
    });
  }
);

// Les autres pages (Combiné Vision, News, Historique — bloc 3+ pour leur contenu
// basket réel, hors scope de ce bloc) : Basket y affiche encore l'état de chargement
// propre.
describe.each(pages.filter(([label]) => !["Live", "Matchs à venir", "Probabilités réussies", "Probabilités échouées"].includes(label)))(
  "%s : passer sur Basket affiche encore un état de chargement propre (pas encore branché sur cette page)",
  (label, Page) => {
    test("jamais une erreur ni une page blanche", async () => {
      const { container } = render(<Page />);
      await waitFor(() => expect(screen.getByTestId("sport-tabs")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("sport-tab-basketball"));
      await waitFor(() => expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument());
      expect(container.textContent).not.toMatch(/erreur/i);
    });
  }
);

// Tennis (bloc 5) : Live et Matchs à venir ont désormais de vrais écrans ; bloc 8 :
// Probabilités réussies/échouées aussi (voir components/PronosticHistoryPage.js) —
// plus de placeholder sur ces 4 pages.
describe.each([
  ["Live", Home], ["Matchs à venir", UpcomingMatches],
  ["Probabilités réussies", ProbabilitesReussies], ["Probabilités échouées", ProbabilitesEchouees],
])(
  "%s : passer sur Tennis affiche un vrai écran, jamais un placeholder",
  (label, Page) => {
    test("aucune erreur, aucune page blanche, aucun placeholder « bientôt disponible »", async () => {
      const { container } = render(<Page />);
      await waitFor(() => expect(screen.getByTestId("sport-tabs")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("sport-tab-tennis"));
      await waitFor(() => expect(screen.getByTestId("sport-tab-tennis")).toHaveAttribute("aria-selected", "true"));
      await waitFor(() => expect(container.textContent).toMatch(/Tennis/));
      expect(screen.queryByTestId("sport-coming-soon")).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(/erreur/i);
    });
  }
);

// Les autres pages (Combiné Vision, News, Historique — hors scope de ce bloc) : Tennis
// y affiche encore l'état de chargement propre.
describe.each(pages.filter(([label]) => !["Live", "Matchs à venir", "Probabilités réussies", "Probabilités échouées"].includes(label)))(
  "%s : passer sur Tennis affiche encore un état de chargement propre (pas encore branché sur cette page)",
  (label, Page) => {
    test("jamais une erreur ni une page blanche", async () => {
      const { container } = render(<Page />);
      await waitFor(() => expect(screen.getByTestId("sport-tabs")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("sport-tab-tennis"));
      await waitFor(() => expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument());
      expect(container.textContent).not.toMatch(/erreur/i);
    });
  }
);
