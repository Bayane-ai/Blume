/**
 * @jest-environment jsdom
 *
 * pages/probabilites-reussies.js et pages/probabilites-echouees.js : chargent la liste
 * réelle depuis /api/pronostic-history (status=success / status=failure), affichent
 * une carte par match (équipes, score final, date, pronostics donnés, badge), les plus
 * récents en premier, et un message clair quand la liste est vide.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import ProbabilitesReussies from "../pages/probabilites-reussies";
import ProbabilitesEchouees from "../pages/probabilites-echouees";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/probabilites-reussies", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { email: "test@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
  },
}));

function itemsFixture(status) {
  return {
    items: [
      {
        match_id: "301", home_team_name: "Arsenal FC", away_team_name: "Chelsea FC",
        match_date: "2026-01-15T15:00:00Z", final_score: { home: 2, away: 1 }, status,
        prediction: { probabilities: { home: 60, draw: 25, away: 15 }, markets: { totalGoals: { line: 2.5, side: "Plus" } } },
      },
      {
        match_id: "302", home_team_name: "Real Madrid", away_team_name: "Barcelona",
        match_date: "2026-01-10T20:00:00Z", final_score: { home: 1, away: 1 }, status,
        prediction: { probabilities: { home: 30, draw: 40, away: 30 }, markets: { totalGoals: { line: 2.5, side: "Moins" } } },
      },
    ],
  };
}

test('"Probabilités réussies" charge /api/pronostic-history?status=success et affiche une carte par match, badge "Succès"', async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/pronostic-history?status=success")) {
      return Promise.resolve({ json: () => Promise.resolve(itemsFixture("success")) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<ProbabilitesReussies />);

  const cards = await screen.findAllByTestId("pronostic-history-card");
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).getByText("Arsenal FC — Chelsea FC")).toBeInTheDocument();
  expect(within(cards[0]).getByTestId("history-badge")).toHaveTextContent("Succès");
  expect(within(cards[1]).getByText("Real Madrid — Barcelona")).toBeInTheDocument();
});

test('"Probabilités échouées" charge /api/pronostic-history?status=failure et affiche une carte par match, badge "Échec"', async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/pronostic-history?status=failure")) {
      return Promise.resolve({ json: () => Promise.resolve(itemsFixture("failure")) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<ProbabilitesEchouees />);

  const cards = await screen.findAllByTestId("pronostic-history-card");
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).getByTestId("history-badge")).toHaveTextContent("Échec");
});

test('liste vide : message clair, jamais une page blanche', async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/pronostic-history")) return Promise.resolve({ json: () => Promise.resolve({ items: [] }) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<ProbabilitesReussies />);
  expect(await screen.findByText("Aucun pronostic réussi pour le moment.")).toBeInTheDocument();
});

test('erreur réseau : message clair, ne plante jamais', async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("network down")));

  render(<ProbabilitesEchouees />);
  expect(await screen.findByText("Aucun pronostic échoué pour le moment.")).toBeInTheDocument();
});
