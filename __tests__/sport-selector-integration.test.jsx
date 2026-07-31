/**
 * @jest-environment jsdom
 *
 * Multi-sport (bloc 0) — vérification bout-en-bout sur la page d'accueil (Live) :
 * sélecteur à 3 onglets, football par défaut, changer d'onglet recharge tout le
 * contenu en dessous SANS recharger la page, football reste inchangé (mêmes appels
 * API, même contenu), basket/tennis affichent un état de chargement propre (jamais
 * une erreur ni une page blanche), la barre de navigation reste identique pour les
 * 3 sports.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Home from "../pages/index";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: pushMock, replace: jest.fn() }),
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { email: "test@example.com" },
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

function mockFetch() {
  return jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

beforeEach(() => {
  clearCookies();
  global.fetch = mockFetch();
});

test("football est sélectionné par défaut, la navigation existante est intacte", async () => {
  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toHaveAttribute("aria-selected", "true"));

  // La barre de navigation à 7 liens reste identique (voir components/SiteHeader.js).
  const nav = screen.getByTestId("main-nav");
  for (const label of ["Live", "Matchs à venir", "Combiné Vision", "News", "Historique", "Probabilités réussies", "Probabilités échouées"]) {
    expect(within(nav).getByText(label)).toBeInTheDocument();
  }
  // Contenu football réel toujours affiché (pas de placeholder).
  expect(screen.getByText("Football en direct")).toBeInTheDocument();
  expect(screen.queryByTestId("sport-coming-soon")).not.toBeInTheDocument();
});

test("passer sur Basket recharge le contenu (état de chargement propre, jamais une erreur ni une page blanche), sans appeler l'API football", async () => {
  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
  const callsBeforeSwitch = global.fetch.mock.calls.length;

  fireEvent.click(screen.getByTestId("sport-tab-basketball"));

  await waitFor(() => expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument());
  expect(screen.getByTestId("sport-tab-basketball")).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByText("Football en direct")).not.toBeInTheDocument();
  expect(screen.queryByText(/erreur/i)).not.toBeInTheDocument();

  // La navigation, elle, reste identique.
  const nav = screen.getByTestId("main-nav");
  expect(within(nav).getByText("Matchs à venir")).toBeInTheDocument();

  // Aucun nouvel appel à /api/live-matches (football) déclenché par le passage sur Basket.
  expect(global.fetch.mock.calls.length).toBe(callsBeforeSwitch);
});

test("revenir sur Football réaffiche le vrai contenu football (jamais un mélange des deux)", async () => {
  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("sport-tab-tennis"));
  await waitFor(() => expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("sport-tab-football"));
  await waitFor(() => expect(screen.getByText("Football en direct")).toBeInTheDocument());
  expect(screen.queryByTestId("sport-coming-soon")).not.toBeInTheDocument();
});

test("le sport choisi est mémorisé et restauré au retour (cookie de préférence)", async () => {
  const { unmount } = render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("sport-tab-basketball"));
  await waitFor(() => expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument());
  unmount();

  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-basketball")).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument();
});
