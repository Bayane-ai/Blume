/**
 * @jest-environment jsdom
 *
 * Multi-sport — vérification bout-en-bout sur la page d'accueil (Live) : sélecteur à
 * 3 onglets, football par défaut, changer d'onglet recharge tout le contenu en
 * dessous SANS recharger la page, football reste inchangé (mêmes appels API, même
 * contenu). Basket (bloc 2) affiche désormais ses VRAIS matchs en direct (voir
 * pages/api/basketball/live-matches.js) ; tennis (pas encore branché) affiche
 * toujours un état de chargement propre. La barre de navigation reste identique pour
 * les 3 sports.
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
    if (url.startsWith("/api/basketball/live-matches")) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            matches: [
              {
                id: "bk-1", status: "IN_PLAY", minute: "5:23", period: "Q3", utcDate: new Date().toISOString(),
                competition: { code: "bk-12", name: "NBA", emblem: "" },
                homeTeam: { id: "bk-10", name: "Lakers", crest: "" },
                awayTeam: { id: "bk-11", name: "Warriors", crest: "" },
                score: { fullTime: { home: 75, away: 68 } },
                pronostic: { available: false },
              },
            ],
          }),
      });
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

test("passer sur Basket recharge le contenu avec de VRAIS matchs (bloc 2), sans appeler l'API football", async () => {
  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
  const footballCallsBeforeSwitch = global.fetch.mock.calls.filter(([url]) => url.startsWith("/api/live-matches")).length;

  fireEvent.click(screen.getByTestId("sport-tab-basketball"));

  await waitFor(() => expect(screen.getByText("Basket en direct")).toBeInTheDocument());
  expect(screen.getByTestId("sport-tab-basketball")).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByText("Football en direct")).not.toBeInTheDocument();
  expect(screen.queryByTestId("sport-coming-soon")).not.toBeInTheDocument();
  expect(screen.queryByText(/erreur/i)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("Lakers")).toBeInTheDocument());
  expect(screen.getByText("Warriors")).toBeInTheDocument();

  // La navigation, elle, reste identique.
  const nav = screen.getByTestId("main-nav");
  expect(within(nav).getByText("Matchs à venir")).toBeInTheDocument();

  // Aucun nouvel appel à /api/live-matches (football) déclenché par le passage sur Basket.
  const footballCallsAfterSwitch = global.fetch.mock.calls.filter(([url]) => url.startsWith("/api/live-matches")).length;
  expect(footballCallsAfterSwitch).toBe(footballCallsBeforeSwitch);
});

test("passer sur Tennis (pas encore branché) affiche un état de chargement propre, jamais une erreur", async () => {
  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("sport-tab-tennis"));
  await waitFor(() => expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument());
  expect(screen.queryByText(/erreur/i)).not.toBeInTheDocument();
});

test("revenir sur Football réaffiche le vrai contenu football (jamais un mélange des deux)", async () => {
  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("sport-tab-basketball"));
  await waitFor(() => expect(screen.getByText("Basket en direct")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("sport-tab-football"));
  await waitFor(() => expect(screen.getByText("Football en direct")).toBeInTheDocument());
  expect(screen.queryByText("Basket en direct")).not.toBeInTheDocument();
  expect(screen.queryByTestId("sport-coming-soon")).not.toBeInTheDocument();
});

test("le sport choisi est mémorisé et restauré au retour (cookie de préférence)", async () => {
  const { unmount } = render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("sport-tab-basketball"));
  await waitFor(() => expect(screen.getByText("Basket en direct")).toBeInTheDocument());
  unmount();

  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("sport-tab-basketball")).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByText("Basket en direct")).toBeInTheDocument();
});
