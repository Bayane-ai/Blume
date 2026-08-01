/**
 * @jest-environment jsdom
 *
 * pages/match/[id].js — bloc 6 (tennis) : "Cliquer sur Analyser mène directement à la
 * page pronostics, sans page intermédiaire". Un match tn- n'a pas encore de modèle de
 * pronostics réel (voir lib/sports/tennis/pronostic.js, bloc 7) : la page doit quand
 * même s'afficher correctement (en-tête, surface, tour), sans jamais appeler
 * /api/analyze ou /api/basketball/analyze (conçus pour d'autres sports, dont les
 * paramètres n'ont aucun sens pour le tennis) ni planter.
 */
import { render, screen, waitFor } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";

let mockRouter;
jest.mock("next/router", () => ({ useRouter: () => mockRouter }));
jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({ session: { email: "test@example.com" }, sessionChecked: true, authorized: true }),
}));
jest.mock("../lib/matchHistory", () => ({ addMatchToHistory: jest.fn() }));

function tennisQuery(overrides = {}) {
  return {
    id: "tn-1", homeTeamId: "tn-10", awayTeamId: "tn-11",
    homeTeamName: "Novak Djokovic", awayTeamName: "Carlos Alcaraz",
    competitionCode: "tn-1", competitionName: "Wimbledon",
    status: "IN_PLAY", minute: "40-30", utcDate: new Date().toISOString(),
    scoreHome: "1", scoreAway: "1",
    surface: "Gazon", round: "Quart de finale",
    homeFlag: "https://example.com/rs.png", awayFlag: "https://example.com/es.png",
    sets: JSON.stringify([{ home: 6, away: 4 }, { home: 4, away: 6 }]),
    ...overrides,
  };
}

beforeEach(() => {
  global.fetch = jest.fn(() => {
    throw new Error("Aucun appel réseau ne devrait jamais être fait pour un match tennis (pas de modèle de pronostics, bloc 7)");
  });
  mockRouter = { isReady: true, query: tennisQuery(), back: jest.fn(), replace: jest.fn() };
});

test("affiche les joueurs, la compétition, la surface et le tour, sans jamais appeler /api/analyze ni /api/basketball/analyze", async () => {
  render(<MatchPage />);

  await waitFor(() => expect(screen.getAllByText(/Novak Djokovic/).length).toBeGreaterThan(0));
  expect(screen.getAllByText(/Carlos Alcaraz/).length).toBeGreaterThan(0);
  expect(screen.getByText("Wimbledon")).toBeInTheDocument();
  expect(screen.getByText("Gazon")).toBeInTheDocument();
  expect(screen.getByText("Quart de finale")).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('affiche un message honnête à la place des cartes de pronostics (jamais un contenu football/basket qui n\'a pas de sens pour le tennis)', async () => {
  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("tennis-pronostic-unavailable")).toBeInTheDocument());
  expect(screen.getByTestId("tennis-pronostic-unavailable")).toHaveTextContent(/tennis/i);
  // Aucun bloc conçu pour un autre sport (corners, hors-jeu, rebonds...) ne doit
  // apparaître pour un match tennis.
  expect(screen.queryByText("Corners")).not.toBeInTheDocument();
  expect(screen.queryByText(/Hors-jeu/)).not.toBeInTheDocument();
});

test("ne montre pas de panneau \"Moments forts\" vide (aucun fil d'événements réel pour le tennis)", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getAllByText(/Novak Djokovic/).length).toBeGreaterThan(0));
  expect(screen.queryByTestId("pinned-highlights")).not.toBeInTheDocument();
});

test("la page ne plante jamais, même sans les champs tennis optionnels (surface/tour/sets absents)", async () => {
  mockRouter = {
    isReady: true,
    query: tennisQuery({ surface: "", round: "", sets: "", homeFlag: "", awayFlag: "" }),
    back: jest.fn(),
    replace: jest.fn(),
  };
  render(<MatchPage />);
  await waitFor(() => expect(screen.getAllByText(/Novak Djokovic/).length).toBeGreaterThan(0));
  expect(screen.getByTestId("tennis-pronostic-unavailable")).toBeInTheDocument();
});
