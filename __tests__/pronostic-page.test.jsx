/**
 * @jest-environment jsdom
 *
 * PROMPT 4 : cliquer sur ANALYSER ouvre UNIQUEMENT la page des pronostics de ce
 * match (pas de détour par une page de match complète). Pour un match à venir,
 * aucun score ne doit s'afficher — seulement les pronostics. Pour un match en
 * direct, les statistiques affichées sont les vraies stats de l'API, mises à jour
 * automatiquement au fil du match.
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Home from "../pages/index";
import MatchPage from "../pages/match/[id]";

const pushMock = jest.fn();
// Objet mutable partagé (préfixé "mock", requis par Jest pour être lu depuis la
// factory ci-dessous) : chaque test ajuste pathname/query avant de rendre la page
// qui l'intéresse — même pattern que nav-two-buttons.test.jsx et
// match-detail-navigation.test.jsx.
let mockRouter = { pathname: "/", isReady: true, query: {}, push: pushMock, replace: jest.fn() };
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

beforeEach(() => {
  pushMock.mockClear();
});

test('cliquer sur ANALYSER depuis une carte navigue UNIQUEMENT vers /match/[id] (la page pronostics), sans détour', async () => {
  mockRouter = { pathname: "/", isReady: true, query: {}, push: pushMock, replace: jest.fn() };
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            matches: [{
              id: 1, status: "IN_PLAY", minute: 40, utcDate: new Date().toISOString(),
              competition: { code: "PL", name: "Premier League", emblem: "" },
              homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
              awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
              score: { fullTime: { home: 1, away: 0 } },
              pronostic: { available: true, home: {}, away: {}, probabilities: { home: 40, draw: 30, away: 30 }, goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 } },
            }],
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<Home />);
  const analyzeBtn = await screen.findByRole("button", { name: /^analyser$/i });
  fireEvent.click(analyzeBtn);

  // Une seule navigation, directement vers la page pronostics du match cliqué —
  // pas de page de match complète intermédiaire.
  expect(pushMock).toHaveBeenCalledTimes(1);
  const target = pushMock.mock.calls[0][0];
  expect(target.pathname).toBe("/match/1");
});

test("match à venir (pas encore commencé) : aucun score n'est affiché, uniquement les pronostics et le coup d'envoi", async () => {
  mockRouter = {
    pathname: "/match/50",
    isReady: true,
    replace: jest.fn(),
    query: {
      id: "50", competitionCode: "PL", homeTeamId: "12", awayTeamId: "13",
      homeTeamName: "Liverpool FC", awayTeamName: "Manchester City FC",
      status: "SCHEDULED", minute: "", utcDate: new Date(Date.now() + 3 * 24 * 3600000).toISOString(),
      scoreHome: "", scoreAway: "",
    },
  };

  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve({
          available: true, live: false,
          home: { name: "Liverpool FC", position: 3, points: 55 },
          away: { name: "Manchester City FC", position: 1, points: 60 },
          probabilities: { home: 30, draw: 25, away: 45 },
          goals: { expectedHome: 1.2, expectedAway: 1.8, over25: 55, bttsYes: 50 },
          correctScores: [{ score: "1-2", probability: 12 }],
          note: "note",
        }),
    })
  );

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("prob-home")).toHaveTextContent("30 %"));

  // Aucun score réel affiché dans l'en-tête (le match n'a pas commencé) — un score
  // exact PRÉDIT peut légitimement apparaître plus bas, dans les pronostics.
  expect(screen.queryByTestId("live-score")).not.toBeInTheDocument();
  // Le coup d'envoi, lui, doit être visible à la place (dans l'en-tête et le détail).
  expect(screen.getByTestId("header-kickoff")).toBeInTheDocument();
  expect(screen.getByText(/^\d{2}\/\d{2} - \d{2}:\d{2}$|^Aujourd'hui/)).toBeInTheDocument();
});

test("match en direct : le score et la minute affichés viennent de l'API et se mettent à jour tout seuls, sans recharger la page", async () => {
  mockRouter = {
    pathname: "/match/1",
    isReady: true,
    replace: jest.fn(),
    query: {
      id: "1", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11",
      homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", status: "IN_PLAY",
      minute: "40", utcDate: new Date().toISOString(), scoreHome: "1", scoreAway: "0",
    },
  };

  let call = 0;
  global.fetch = jest.fn(() => {
    call += 1;
    const [score, minute] = call === 1 ? [{ home: 1, away: 0 }, 40] : [{ home: 2, away: 0 }, 42];
    return Promise.resolve({
      json: () =>
        Promise.resolve({
          available: true, live: true,
          home: { name: "Arsenal FC", position: 3, points: 55 },
          away: { name: "Chelsea FC", position: 7, points: 44 },
          probabilities: { home: call === 1 ? 55 : 78, draw: 20, away: 25 },
          goals: { expectedHome: 1.6, expectedAway: 1.1, over25: 54, bttsYes: 58 },
          correctScores: [{ score: "2-0", probability: 15 }],
          note: "note",
          matchStatus: "IN_PLAY",
          matchMinute: minute,
          matchScore: score,
        }),
    });
  });

  render(<MatchPage />);

  // Attend la résolution du premier appel réel à /api/analyze (pas seulement
  // l'instantané des query params pris au moment du clic, qui peut être périmé).
  await waitFor(() => expect(screen.getByTestId("prob-home")).toHaveTextContent("55 %"));
  expect(screen.getByTestId("live-score")).toHaveTextContent("1 - 0");
  expect(screen.getByTestId("live-minute")).toHaveTextContent("40’");

  // Laisse un cycle d'actualisation automatique (2s) se déclencher.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2200));
  });

  expect(call).toBeGreaterThan(1);
  await waitFor(() => expect(screen.getByTestId("prob-home")).toHaveTextContent("78 %"));
  expect(screen.getByTestId("live-score")).toHaveTextContent("2 - 0");
  expect(screen.getByTestId("live-minute")).toHaveTextContent("42’");
}, 10000);
