/**
 * @jest-environment jsdom
 *
 * pages/historique.js — liste les matchs consultés (lib/matchHistory.js), les plus
 * récents en premier, sans bouton "Analyser", et un message clair quand la liste est
 * vide.
 */
import { render, screen } from "@testing-library/react";
import Historique from "../pages/historique";
import { addMatchToHistory } from "../lib/matchHistory";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/historique", push: jest.fn(), replace: jest.fn() }),
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

beforeEach(() => {
  window.localStorage.clear();
});

test("affiche un message clair quand aucun match n'a encore été consulté", async () => {
  render(<Historique />);
  expect(await screen.findByTestId("match-history-empty")).toHaveTextContent("Aucun match consulté pour le moment.");
});

test("affiche une carte par match consulté, le plus récent en premier, sans bouton Analyser", async () => {
  addMatchToHistory({
    id: 1, status: "SCHEDULED", minute: null, utcDate: "2026-01-01T15:00:00Z",
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
    score: { fullTime: { home: null, away: null } },
  });
  addMatchToHistory({
    id: 2, status: "FINISHED", minute: 90, utcDate: "2026-01-02T15:00:00Z",
    competition: { code: "PD", name: "LaLiga", emblem: "" },
    homeTeam: { id: 20, name: "Real Madrid", crest: "" },
    awayTeam: { id: 21, name: "Barcelona", crest: "" },
    score: { fullTime: { home: 2, away: 1 } },
  });

  render(<Historique />);

  const cards = await screen.findAllByTestId("match-history-card");
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveTextContent("Real Madrid");
  expect(cards[1]).toHaveTextContent("Arsenal FC");
  expect(screen.queryByRole("button", { name: /^analyser$/i })).not.toBeInTheDocument();
});
