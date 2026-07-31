/**
 * @jest-environment jsdom
 *
 * pages/match/[id].js — bloc 4 (basket) : "Moments forts" épinglé en haut pour un
 * match basket en direct (jamais "Événement non disponible"), recalcul en direct
 * (bandeau explicatif basket, pas football), et compte-rendu de fin de match visible
 * dès qu'on ouvre un match basket déjà terminé.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";

let mockRouter;
jest.mock("next/router", () => ({ useRouter: () => mockRouter }));
jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({ session: { email: "test@example.com" }, sessionChecked: true, authorized: true }),
}));
jest.mock("../lib/matchHistory", () => ({ addMatchToHistory: jest.fn() }));

function basketQuery(overrides = {}) {
  return {
    id: "bk-1", homeTeamId: "bk-10", awayTeamId: "bk-11", season: "2025-2026",
    homeTeamName: "Lakers", awayTeamName: "Warriors",
    status: "IN_PLAY", minute: "", utcDate: new Date().toISOString(),
    scoreHome: "60", scoreAway: "55",
    ...overrides,
  };
}

function market(line, side) {
  return { available: true, line, side, lines: [{ line, side }] };
}

function analyzeResponse(overrides = {}) {
  return {
    available: true, live: true,
    home: { name: "Lakers" }, away: { name: "Warriors" },
    probabilities: { home: 65, away: 35 },
    goals: { expectedHome: 118, expectedAway: 104, expectedTotal: 222 },
    correctScores: ["118-104"],
    pointSpread: { favorite: "home", safe: { line: 5.5, side: "Moins" }, risky: { line: 12.5, side: "Plus" } },
    markets: { totalPoints: market(221.5, "Plus"), totalHome: market(117.5, "Plus"), totalAway: market(103.5, "Moins") },
    periods: {
      quarter1: market(52.5, "Plus"), firstHalf: market(104.5, "Plus"), secondHalf: market(103.5, "Moins"),
      activeHalfLabel: "Total 2ème mi-temps", activeHalf: market(103.5, "Moins"),
    },
    rebounds: { total: market(84.5, "Plus"), home: market(43.5, "Plus"), away: market(40.5, "Moins") },
    assists: { total: market(45.5, "Moins"), home: market(24.5, "Plus"), away: market(21.5, "Moins") },
    threePointers: { total: market(22.5, "Plus"), home: market(12.5, "Plus"), away: market(10.5, "Moins") },
    fouls: { total: market(37.5, "Moins"), home: market(18.5, "Moins"), away: market(19.5, "Plus") },
    turnovers: { total: market(24.5, "Moins") },
    freeThrows: { total: market(31.5, "Plus") },
    players: { home: {}, away: {} },
    narrative: { winProbability: "Lakers part favori..." },
    note: "note", statsNote: "stats note",
    matchStatus: "IN_PLAY", matchScore: { home: 60, away: 55 },
    events: [
      { id: "kickoff", kind: "KICKOFF", label: "Coup d'envoi" },
      { id: "run-1", kind: "RUN", label: "Série de 8-0 pour Lakers (60 - 55)", quarter: "Q3", clock: "5:00" },
    ],
    timelineNote: "Basé sur le score officiel...",
    ...overrides,
  };
}

test("le panneau \"Moments forts\" est épinglé pour un match basket en direct, jamais \"Événement non disponible\"", async () => {
  mockRouter = { pathname: "/match/bk-1", isReady: true, replace: jest.fn(), query: basketQuery() };
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(analyzeResponse()) }));

  render(<MatchPage />);
  const pinned = await screen.findByTestId("pinned-highlights");
  expect(pinned).toHaveStyle({ position: "sticky", top: "0px" });
  await within(pinned).findByText("Série de 8-0 pour Lakers (60 - 55)");
  expect(within(pinned).getByText("Coup d'envoi")).toBeInTheDocument();
  expect(screen.queryByText(/Événement non disponible/i)).not.toBeInTheDocument();
});

test("bandeau explicatif du recalcul en direct : mentionne les métriques basket, pas corners/cartons", async () => {
  mockRouter = { pathname: "/match/bk-1", isReady: true, replace: jest.fn(), query: basketQuery() };
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(analyzeResponse()) }));

  render(<MatchPage />);
  await screen.findByTestId("pinned-highlights");
  expect(screen.getByText(/scores finaux probables et les totaux de points suivent l'évolution/)).toBeInTheDocument();
  expect(screen.queryByText(/Corners, Hors-jeu/)).not.toBeInTheDocument();
});

test("toutes les cartes basket s'affichent (probabilité, périodes, rebonds/passes/3pts/fautes, ballons perdus/lancers francs, joueurs)", async () => {
  mockRouter = { pathname: "/match/bk-1", isReady: true, replace: jest.fn(), query: basketQuery() };
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(analyzeResponse()) }));

  render(<MatchPage />);
  await screen.findByTestId("basket-win-probability-card");
  expect(screen.getByTestId("basket-periods-card")).toBeInTheDocument();
  expect(screen.getByTestId("basket-stat-rebounds")).toBeInTheDocument();
  expect(screen.getByTestId("basket-stat-turnovers")).toBeInTheDocument();
  expect(screen.getByTestId("basket-players-to-watch-card")).toBeInTheDocument();
});

test("match basket terminé : le compte-rendu (bloc 4, point 4) s'affiche dès l'ouverture, avant les cartes de pronostics", async () => {
  mockRouter = {
    pathname: "/match/bk-1", isReady: true, replace: jest.fn(),
    query: basketQuery({ status: "FINISHED", scoreHome: "118", scoreAway: "104" }),
  };
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(
        analyzeResponse({
          live: false, matchStatus: "FINISHED", matchScore: { home: 118, away: 104 },
          historyStatus: "success",
          verification: {
            winner: true, correctScores: true, totalPoints: true, totalHome: true, totalAway: false,
            quarter1: null, firstHalf: true, secondHalf: false,
            pointSpread: { safe: true, risky: false },
            rebounds: { total: true, home: true, away: false },
            assists: { total: false, home: null, away: null },
            threePointers: { total: true, home: true, away: true },
            fouls: { total: false, home: false, away: true },
            turnovers: { total: true },
            freeThrows: { total: false },
          },
          events: [
            { id: "kickoff", kind: "KICKOFF", label: "Coup d'envoi" },
            { id: "final", kind: "FULL_TIME", label: "Fin du match : 118 - 104" },
          ],
        })
      ),
    })
  );

  render(<MatchPage />);
  const recap = await screen.findByTestId("basket-match-outcome-recap");
  expect(recap).toHaveTextContent(/Bilan global du match.*Succès/);

  // Le compte-rendu apparaît AVANT la carte "Probabilité de victoire".
  const winCard = await screen.findByTestId("basket-win-probability-card");
  expect(recap.compareDocumentPosition(winCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // Match terminé : pas de panneau épinglé (le match n'est plus en direct), mais la
  // timeline (avec la fin de match) reste visible plus bas sur la page.
  expect(screen.queryByTestId("pinned-highlights")).not.toBeInTheDocument();
  expect(screen.getByText("Fin du match : 118 - 104")).toBeInTheDocument();
});
