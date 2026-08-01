/**
 * @jest-environment jsdom
 *
 * pages/match/[id].js — bloc 7 (tennis) : "Cliquer sur Analyser mène directement à la
 * page pronostics, sans page intermédiaire" — appelle bien /api/tennis/analyze (jamais
 * /api/analyze ni /api/basketball/analyze, conçus pour d'autres sports) et affiche le
 * pronostic complet renvoyé, avec la règle figé/live.
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

function line(l, side) {
  return { available: true, lines: [{ line: l, side, confidence: 55 }] };
}

function analyzeResponse(overrides = {}) {
  return {
    available: true, live: false, bestOf: 5, surface: "Gazon",
    home: { name: "Novak Djokovic", ranking: 1, form: "WWWWL" },
    away: { name: "Carlos Alcaraz", ranking: 2, form: "WWLWW" },
    probabilities: { home: 55.2, away: 44.8 },
    setScores: [
      { score: "3-0", winner: "p1", probability: 20 },
      { score: "3-1", winner: "p1", probability: 18 },
      { score: "1-3", winner: "p2", probability: 15 },
      { score: "0-3", winner: "p2", probability: 12 },
    ],
    gameTotals: { total: line(34.5, "Plus"), home: line(18.5, "Plus"), away: line(16.5, "Moins") },
    gameHandicap: { favorite: "home", safe: { line: 1.5, side: "Plus" }, risky: { line: 3.5, side: "Plus" } },
    setsBlock: { totalSets: { line: 3.5, side: "Plus" }, bothWinASet: "Oui", firstSetWinner: "home", firstSetGames: line(9.5, "Moins") },
    aces: { total: line(15.5, "Plus"), home: line(9.5, "Plus"), away: line(5.5, "Moins") },
    doubleFaults: { total: line(5.5, "Moins"), home: line(2.5, "Moins"), away: line(3.5, "Plus") },
    breaks: { total: line(3.5, "Plus"), home: line(1.5, "Plus"), away: line(1.5, "Moins") },
    tiebreak: { likely: "Oui" },
    serviceReturnContext: {
      home: { firstServeInPct: 65, firstServeWonPct: 78, secondServeWonPct: 53, breakPointsConvertedPct: 45 },
      away: { firstServeInPct: 60, firstServeWonPct: 72, secondServeWonPct: 49, breakPointsConvertedPct: 40 },
    },
    narrative: {
      winProbability: "Novak Djokovic part favori (55.2 %), classé 1er mondial.",
      matchScenario: "Sur gazon, Djokovic devrait tenir son service plus facilement. Peu de breaks sont attendus.",
    },
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

test("appelle /api/tennis/analyze (jamais /api/analyze ni /api/basketball/analyze), avec les paramètres joueur/surface/catégorie", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const url = global.fetch.mock.calls[0][0];
  expect(url).toContain("/api/tennis/analyze");
  expect(url).toContain("homeTeamId=tn-10");
  expect(url).toContain("surface=Gazon");
  expect(url).toContain("category=Grand+Slam");
});

test("affiche le pronostic complet renvoyé par l'API : probabilité de victoire, scores en sets, totaux de jeux", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
  expect(screen.getByTestId("tennis-prob-home")).toHaveTextContent("55.2 %");
  expect(screen.getByTestId("tennis-set-scores")).toHaveTextContent("3 - 0");
  expect(screen.getByTestId("tennis-market-total")).toHaveTextContent("Plus de 34,5");
});

test("affiche aces/doubles fautes/breaks/tie-break, contexte service-retour, et le scénario du match", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-stat-aces-total")).toBeInTheDocument());
  expect(screen.getByTestId("tennis-stat-tiebreak-value")).toHaveTextContent("Oui");
  expect(screen.getByTestId("tennis-service-return-context")).toBeInTheDocument();
  expect(screen.getByTestId("tennis-match-scenario")).toBeInTheDocument();
});

test("jamais de contenu conçu pour un autre sport (corners, rebonds...) sur un match tennis", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
  expect(screen.queryByText("Corners")).not.toBeInTheDocument();
  expect(screen.queryByText("Rebonds")).not.toBeInTheDocument();
});

test("ne montre pas de panneau \"Moments forts\" (aucun fil d'événements réel pour le tennis)", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
  expect(screen.queryByTestId("pinned-highlights")).not.toBeInTheDocument();
});

test("analyse dégradée mais indisponible : message honnête, jamais une page cassée", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ available: false, reason: "profil de joueur indisponible" }) }));
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByText("profil de joueur indisponible")).toBeInTheDocument());
});

test("match en direct : le bandeau explicatif mentionne le recalcul en direct spécifique au tennis", async () => {
  mockRouter = { isReady: true, query: tennisQuery({ status: "IN_PLAY", minute: "40-30" }), back: jest.fn(), replace: jest.fn() };
  global.fetch = jest.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ live: true, matchStatus: "IN_PLAY", matchMinute: "40-30", matchPeriod: "Set 2" })) })
  );
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("tennis-win-probability-card")).toBeInTheDocument());
  expect(screen.getByText(/scores en sets probables et les totaux de jeux suivent l'évolution du match en direct/)).toBeInTheDocument();
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
