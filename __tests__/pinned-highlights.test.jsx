/**
 * @jest-environment jsdom
 *
 * Bloc 3 : sur la page d'un match EN DIRECT, "Moments forts" est épinglé juste sous
 * le score (position: sticky), avant le reste du contenu (pronostics) — pas relégué
 * en bas de page comme pour un match terminé/à venir.
 */
import { render, screen } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";

let mockRouter;
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

function baseQuery(overrides = {}) {
  return {
    id: "1", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11",
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
    utcDate: new Date().toISOString(),
    ...overrides,
  };
}

test("match en direct : \"Moments forts\" est épinglé (sticky) juste après l'en-tête, avant les pronostics", async () => {
  mockRouter = {
    pathname: "/match/1", isReady: true, replace: jest.fn(),
    query: baseQuery({ status: "IN_PLAY", minute: "40", scoreHome: "1", scoreAway: "0" }),
  };
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve({
        available: true, live: true,
        home: { name: "Arsenal FC" }, away: { name: "Chelsea FC" },
        probabilities: { home: 55, draw: 20, away: 25 },
        goals: { expectedHome: 1.6, expectedAway: 1.1, over25: 54, bttsYes: 58 },
        correctScores: [{ score: "2-0", probability: 15 }],
        note: "note",
        matchStatus: "IN_PLAY", matchMinute: 40, matchScore: { home: 1, away: 0 },
        events: [{ id: "e1", minute: 12, type: "GOAL", teamId: "10", player: { name: "Bukayo Saka" }, scoreAfter: { home: 1, away: 0 } }],
      }),
    })
  );

  render(<MatchPage />);

  const pinned = await screen.findByTestId("pinned-highlights");
  expect(pinned).toHaveStyle({ position: "sticky", top: "0px" });
  await screen.findByText("Bukayo Saka");
  expect(pinned.querySelector('[data-testid="match-timeline"]')).toBeInTheDocument();

  // "Moments forts" apparaît avant le panneau des pronostics dans le document.
  const pronosticHeading = await screen.findByText("Pronostics automatiques");
  expect(pinned.compareDocumentPosition(pronosticHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // Pas de deuxième "Moments forts" en bas de page pour un match en direct.
  expect(screen.getAllByText("Moments forts")).toHaveLength(1);
});

test("match en direct sans aucun événement : message optimiste, jamais \"indisponible\"", async () => {
  mockRouter = {
    pathname: "/match/1", isReady: true, replace: jest.fn(),
    query: baseQuery({ status: "IN_PLAY", minute: "3", scoreHome: "0", scoreAway: "0" }),
  };
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve({
        available: true, live: true,
        home: { name: "Arsenal FC" }, away: { name: "Chelsea FC" },
        probabilities: { home: 40, draw: 30, away: 30 },
        goals: { expectedHome: 1, expectedAway: 1, over25: 40, bttsYes: 40 },
        correctScores: [{ score: "1-0", probability: 12 }],
        note: "note",
        matchStatus: "IN_PLAY", matchMinute: 3, matchScore: { home: 0, away: 0 },
        events: null,
      }),
    })
  );

  render(<MatchPage />);

  await screen.findByTestId("pinned-highlights");
  expect(await screen.findByText("Coup d'envoi — en attente des premiers événements.")).toBeInTheDocument();
  expect(screen.queryByText("Événements non disponibles pour ce match.")).not.toBeInTheDocument();
});

test("match pas en direct (terminé) : \"Moments forts\" reste en bas de page, pas épinglé", async () => {
  mockRouter = {
    pathname: "/match/2", isReady: true, replace: jest.fn(),
    query: baseQuery({ id: "2", status: "FINISHED", minute: "90", scoreHome: "3", scoreAway: "1" }),
  };
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve({
        available: true, live: false,
        home: { name: "Arsenal FC" }, away: { name: "Chelsea FC" },
        probabilities: { home: 60, draw: 20, away: 20 },
        goals: { expectedHome: 2, expectedAway: 1, over25: 60, bttsYes: 50 },
        correctScores: [{ score: "3-1", probability: 10 }],
        note: "note",
        events: null,
      }),
    })
  );

  render(<MatchPage />);

  await screen.findByText("Moments forts");
  expect(screen.queryByTestId("pinned-highlights")).not.toBeInTheDocument();
  expect(screen.getByText("Événements non disponibles pour ce match.")).toBeInTheDocument();
});
