/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";

let mockQuery = {};
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

function pronosticFor(homeTeamName, awayTeamName) {
  return {
    available: true,
    live: false,
    home: { name: homeTeamName, position: 1, points: 10 },
    away: { name: awayTeamName, position: 2, points: 8 },
    probabilities: { home: 40, draw: 30, away: 30 },
    goals: { expectedHome: 1, expectedAway: 1, over25: 40, bttsYes: 40 },
    correctScores: [{ score: "1-1", probability: 20 }],
    note: "note",
  };
}

test("naviguer d'un match à un autre (même composant réutilisé par Next.js) relance bien l'analyse au lieu de garder l'ancienne", async () => {
  global.fetch = jest.fn((url) => {
    const params = new URL(url, "http://localhost").searchParams;
    const homeTeamName = params.get("homeTeamName");
    const awayTeamName = params.get("awayTeamName");
    return Promise.resolve({ json: () => Promise.resolve(pronosticFor(homeTeamName, awayTeamName)) });
  });

  mockQuery = {
    id: "1", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11",
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
  };
  const { rerender } = render(<MatchPage />);
  await waitFor(() => expect(screen.getByText(/Arsenal FC/)).toBeInTheDocument());

  // Simule une navigation client-side vers un AUTRE match : Next.js réutilise ce même
  // composant, seul router.query change (pas de remount).
  mockQuery = {
    id: "2", competitionCode: "PL", homeTeamId: "20", awayTeamId: "21",
    homeTeamName: "Liverpool FC", awayTeamName: "Manchester City FC",
  };
  rerender(<MatchPage />);

  await waitFor(() => expect(screen.getByText(/Liverpool FC/)).toBeInTheDocument());
  expect(screen.queryByText(/Arsenal FC/)).not.toBeInTheDocument();
});
