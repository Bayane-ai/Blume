/**
 * @jest-environment jsdom
 *
 * pages/match/[id].js — tennis (Live Tennis API) : "Cliquer sur Analyser mène
 * directement à la page pronostics" — appelle /api/tennis/analyze (jamais
 * /api/analyze ni /api/basketball/analyze) et affiche les 4 lignes de pronostic
 * calculables avec ce plan gratuit (winner, set en cours, jeux, sets) — jamais de
 * timeline tennis (aucune source de données de points/événements avec cette API).
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
    status: "SCHEDULED", minute: "", utcDate: new Date(Date.now() + 3600000).toISOString(),
    scoreHome: "", scoreAway: "",
    surface: "Gazon", round: "Quart de finale", category: "Grand Slam",
    homeFlag: "https://example.com/rs.png", awayFlag: "https://example.com/es.png",
    sets: "",
    ...overrides,
  };
}

function analyzeResponse(overrides = {}) {
  return {
    available: true, live: false, bestOf: 5,
    home: { name: "Novak Djokovic", ranking: 1 },
    away: { name: "Carlos Alcaraz", ranking: 2 },
    probabilities: { home: 55.2, away: 44.8 },
    currentSetProbabilities: { home: 52, away: 48 },
    gameTotals: { line: 34.5, side: "Plus", confidence: 55, lines: [{ line: 34.5, side: "Plus", confidence: 55 }] },
    totalSets: { line: 3.5, side: "Plus" },
    note: "Estimation statistique (modèle de Markov jeu → set → match).",
    matchStatus: "SCHEDULED", matchScore: null, matchMinute: null, matchPeriod: null,
    ...overrides,
  };
}

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    expect(url).toContain("/api/tennis/analyze");
    return Promise.resolve({ json: () => Promise.resolve(analyzeResponse()) });
  });
  mockRouter = { isReady: true, query: tennisQuery(), back: jest.fn(), replace: jest.fn() };
});

test("appelle /api/tennis/analyze (jamais /api/analyze ni /api/basketball/analyze), avec les paramètres joueur/catégorie", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const url = global.fetch.mock.calls[0][0];
  expect(url).toContain("/api/tennis/analyze");
  expect(url).toContain("homeTeamId=tn-10");
  expect(url).toContain("category=Grand+Slam");
});

test("affiche le pronostic complet renvoyé par l'API : vainqueur, set en cours, total de jeux, total de sets", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
  expect(screen.getByTestId("tennis-prob-home")).toHaveTextContent("55.2 %");
  expect(screen.getByTestId("tennis-current-set-card")).toBeInTheDocument();
  expect(screen.getByTestId("tennis-total-games")).toHaveTextContent("Plus de 34,5");
  expect(screen.getByTestId("tennis-total-sets")).toHaveTextContent("Plus de 3,5");
});

test("jamais de contenu conçu pour un autre sport (corners, rebonds...) sur un match tennis", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
  expect(screen.queryByText("Corners")).not.toBeInTheDocument();
  expect(screen.queryByText("Rebonds")).not.toBeInTheDocument();
});

test("jamais de panneau \"Moments forts\" épinglé pour le tennis (aucune source de points/événements sur ce plan)", async () => {
  mockRouter = { isReady: true, query: tennisQuery({ status: "IN_PLAY", minute: "40-30" }), back: jest.fn(), replace: jest.fn() };
  global.fetch = jest.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ live: true, matchStatus: "IN_PLAY", matchMinute: "40-30", matchPeriod: "Set 2" })) })
  );
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
  expect(screen.queryByTestId("pinned-highlights")).not.toBeInTheDocument();
});

test("match tennis terminé, le compte-rendu s'affiche dès l'ouverture, avant les cartes de pronostics", async () => {
  mockRouter = { isReady: true, query: tennisQuery({ status: "FINISHED" }), back: jest.fn(), replace: jest.fn() };
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(analyzeResponse({
        live: false, matchStatus: "FINISHED", matchScore: { home: 3, away: 0 },
        historyStatus: "success",
        verification: { winner: true, totalGames: true, totalSets: false },
      })),
    })
  );

  render(<MatchPage />);
  const recap = await screen.findByTestId("tennis-match-outcome-recap");
  expect(recap).toHaveTextContent(/Bilan global du match.*Succès/);

  const winCard = await screen.findByTestId("tennis-win-probability-card");
  expect(recap.compareDocumentPosition(winCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("pronostic indisponible : message honnête, jamais une page cassée", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ available: false, reason: "classement indisponible" }) }));
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByText("classement indisponible")).toBeInTheDocument());
});

test("match en direct : le bandeau explicatif mentionne le recalcul en direct spécifique au tennis", async () => {
  mockRouter = { isReady: true, query: tennisQuery({ status: "IN_PLAY", minute: "40-30" }), back: jest.fn(), replace: jest.fn() };
  global.fetch = jest.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ live: true, matchStatus: "IN_PLAY", matchMinute: "40-30", matchPeriod: "Set 2" })) })
  );
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
  expect(screen.getByText(/suivent l'évolution du match en direct/)).toBeInTheDocument();
});

test("la page ne plante jamais, même sans les champs tennis optionnels (surface/tour/sets absents)", async () => {
  mockRouter = {
    isReady: true,
    query: tennisQuery({ surface: "", round: "", sets: "", homeFlag: "", awayFlag: "", category: "" }),
    back: jest.fn(),
    replace: jest.fn(),
  };
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
});
