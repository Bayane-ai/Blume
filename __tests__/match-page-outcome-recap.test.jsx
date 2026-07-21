/**
 * @jest-environment jsdom
 *
 * Bloc 4 (parcours vidéo) : "quand on appuie sur un club/match déjà terminé", le
 * compte-rendu (components/MatchOutcomeRecap.js) doit apparaître directement sur la
 * page du match — jamais sur un match en direct ou pas encore commencé, jamais sans
 * donnée de vérification réelle.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";

let mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: {} };
jest.mock("next/router", () => ({
  useRouter: () => mockRouter,
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

function baseAnalyzeResponse(overrides = {}) {
  return {
    available: true, live: false,
    home: { name: "Arsenal FC", position: 3, points: 55 },
    away: { name: "Chelsea FC", position: 7, points: 44 },
    probabilities: { home: 60, draw: 25, away: 15 },
    goals: { expectedHome: 1.6, expectedAway: 1.1, over25: 54, bttsYes: 58 },
    correctScores: [{ score: "2-0", probability: 15 }],
    markets: {
      totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] },
      totalHome: { line: 1.5, side: "Plus", lines: [{ line: 1.5, side: "Plus" }] },
      totalAway: { line: 0.5, side: "Moins", lines: [{ line: 0.5, side: "Moins" }] },
      shots: { line: 20.5, side: "Plus", lines: [{ line: 20.5, side: "Plus" }] },
      shotsOnTarget: { line: 6.5, side: "Plus", lines: [{ line: 6.5, side: "Plus" }] },
      yellowCards: { safe: { line: 3.5, side: "Moins" }, risky: { line: 2.5, side: "Moins" } },
      redCards: { safe: { line: 0.5, side: "Moins" }, risky: { line: 0.5, side: "Plus" } },
    },
    matchStats: {},
    note: "note",
    matchStatus: "FINISHED",
    matchMinute: 90,
    matchScore: { home: 2, away: 0 },
    ...overrides,
  };
}

function baseQuery() {
  return {
    id: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11",
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", status: "FINISHED",
    minute: "90", utcDate: new Date().toISOString(), scoreHome: "2", scoreAway: "0",
  };
}

test("un match déjà terminé, déjà classé : le compte-rendu (Réussi/Échec + lignes ✓/✗) apparaît directement sur la page", async () => {
  mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: baseQuery() };
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(baseAnalyzeResponse({
        historyStatus: "success",
        verification: { totalGoals: true, totalHome: false, totalAway: true, shots: true, shotsOnTarget: false, yellowCards: { safe: true, risky: null }, redCards: { safe: null, risky: null }, corners: {}, offsides: {}, fouls: {}, throwIns: {} },
      })),
    })
  );

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("match-outcome-recap")).toBeInTheDocument());
  const recap = screen.getByTestId("match-outcome-recap");
  expect(within(recap).getByTestId("recap-win-probability")).toHaveTextContent(/Réussi/);
  expect(within(recap).getByText(/^Total : Plus de 2,5$/)).toBeInTheDocument();
});

test("un match en direct : jamais de compte-rendu affiché (le match n'est pas terminé)", async () => {
  mockRouter = {
    pathname: "/match/777", isReady: true, replace: jest.fn(),
    query: { ...baseQuery(), status: "IN_PLAY" },
  };
  global.fetch = jest.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(baseAnalyzeResponse({ matchStatus: "IN_PLAY", live: true })) })
  );

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("prob-home")).toHaveTextContent("60 %"));
  expect(screen.queryByTestId("match-outcome-recap")).not.toBeInTheDocument();
});

test("un match terminé mais pas encore classé (aucune donnée de vérification) : jamais de compte-rendu inventé", async () => {
  mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: baseQuery() };
  global.fetch = jest.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(baseAnalyzeResponse()) }) // pas de historyStatus/verification
  );

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("prob-home")).toHaveTextContent("60 %"));
  expect(screen.queryByTestId("match-outcome-recap")).not.toBeInTheDocument();
});
