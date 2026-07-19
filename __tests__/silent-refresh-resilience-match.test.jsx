/**
 * @jest-environment jsdom
 *
 * Sur la page d'un match en direct, un cycle d'actualisation automatique qui échoue
 * (quota API, réseau) ne doit jamais faire disparaître le pronostic déjà affiché.
 */
import { render, screen, act } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";

const mockQuery = {
  id: "1", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11",
  homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", status: "IN_PLAY",
  minute: "40", scoreHome: "1", scoreAway: "0",
};

jest.mock("next/router", () => ({
  useRouter: () => ({ isReady: true, query: mockQuery, replace: jest.fn() }),
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

const pronostic = {
  available: true,
  live: true,
  home: { name: "Arsenal FC", position: 3, points: 55 },
  away: { name: "Chelsea FC", position: 7, points: 44 },
  probabilities: { home: 48.2, draw: 26.1, away: 25.7 },
  goals: { expectedHome: 1.6, expectedAway: 1.1, expectedTotal: 2.7, over25: 54.3, bttsYes: 58.9 },
  matchStatus: "IN_PLAY",
  matchMinute: 40,
  matchScore: { home: 1, away: 0 },
};

test("le pronostic déjà affiché reste visible même si un cycle d'actualisation échoue", async () => {
  let analyzeCallCount = 0;
  global.fetch = jest.fn(() => {
    analyzeCallCount += 1;
    if (analyzeCallCount === 1) {
      return Promise.resolve({ json: () => Promise.resolve(pronostic) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ error: "Erreur API football-data (code 429)" }) });
  });

  render(<MatchPage />);
  await screen.findByText("48.2%");

  await act(async () => {
    await new Promise((r) => setTimeout(r, 2200));
  });

  expect(analyzeCallCount).toBeGreaterThan(1);
  expect(screen.getByText("48.2%")).toBeInTheDocument();
  expect(screen.queryByText(/pronostics indisponibles/i)).not.toBeInTheDocument();
}, 10000);
