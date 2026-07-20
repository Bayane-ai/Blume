/**
 * @jest-environment jsdom
 *
 * PROMPT 3 : chaque carte de match (compétition, deux équipes, score uniquement si
 * en cours/terminé) doit afficher son bouton ANALYSER directement avec la carte,
 * visible sans avoir à entrer dans le match — sur "Matchs en ligne" ET "Matchs à
 * venir".
 */
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import Home from "../pages/index";
import UpcomingMatches from "../pages/a-venir";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: pushMock, replace: jest.fn() }),
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

const basePronostic = {
  available: true, home: {}, away: {},
  probabilities: { home: 40, draw: 30, away: 30 },
  goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 },
};

function liveMatchesFixture() {
  return {
    matches: [
      {
        id: 1, status: "IN_PLAY", minute: 20, utcDate: new Date().toISOString(),
        competition: { code: "PL", name: "Premier League", emblem: "" },
        homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
        awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
        score: { fullTime: { home: 1, away: 0 } },
        pronostic: basePronostic,
      },
      {
        id: 2, status: "PAUSED", minute: 45, utcDate: new Date().toISOString(),
        competition: { code: "PD", name: "LaLiga", emblem: "" },
        homeTeam: { id: 20, name: "Real Madrid", crest: "" },
        awayTeam: { id: 21, name: "Barcelona", crest: "" },
        score: { fullTime: { home: 2, away: 2 } },
        pronostic: basePronostic,
      },
      {
        id: 3, status: "FINISHED", minute: 90, utcDate: new Date().toISOString(),
        competition: { code: "SA", name: "Serie A", emblem: "" },
        homeTeam: { id: 30, name: "Juventus FC", crest: "" },
        awayTeam: { id: 31, name: "AC Milan", crest: "" },
        score: { fullTime: { home: 3, away: 1 } },
        pronostic: basePronostic,
      },
    ],
  };
}

function upcomingMatchesFixture() {
  const kickoff1 = new Date(Date.now() + 2 * 24 * 3600000).toISOString();
  const kickoff2 = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
  return {
    competitions: [
      {
        code: "PL", name: "Premier League",
        matches: [
          {
            id: 101, status: "SCHEDULED", minute: null, utcDate: kickoff1,
            competition: { code: "PL", name: "Premier League", emblem: "" },
            homeTeam: { id: 12, name: "Liverpool FC", crest: "" },
            awayTeam: { id: 13, name: "Manchester City FC", crest: "" },
            score: { fullTime: { home: null, away: null } },
            pronostic: basePronostic,
          },
        ],
      },
      {
        code: "BL1", name: "Bundesliga",
        matches: [
          {
            id: 102, status: "TIMED", minute: null, utcDate: kickoff2,
            competition: { code: "BL1", name: "Bundesliga", emblem: "" },
            homeTeam: { id: 40, name: "Bayern Munich", crest: "" },
            awayTeam: { id: 41, name: "Borussia Dortmund", crest: "" },
            score: { fullTime: { home: null, away: null } },
            pronostic: basePronostic,
          },
        ],
      },
    ],
  };
}

function mockFetchRouter() {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve(liveMatchesFixture()) });
    }
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve(upcomingMatchesFixture()) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

beforeEach(() => {
  mockFetchRouter();
  pushMock.mockClear();
});

test('"Matchs en ligne" : chaque carte affiche compétition + équipes + score (en cours/terminé) + son bouton ANALYSER, tous ensemble sans navigation', async () => {
  render(<Home />);

  const list = await waitFor(() => {
    const el = screen.getByTestId("match-list");
    expect(within(el).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(3);
    return el;
  });

  const fixtures = [
    { comp: "Premier League", home: "Arsenal FC", away: "Chelsea FC", score: "1 - 0" },
    { comp: "LaLiga", home: "Real Madrid", away: "Barcelona", score: "2 - 2" },
    { comp: "Serie A", home: "Juventus FC", away: "AC Milan", score: "3 - 1" },
  ];

  const buttons = within(list).getAllByRole("button", { name: /^analyser$/i });
  fixtures.forEach((f, i) => {
    // Le bouton ANALYSER et le contenu de la carte partagent le même conteneur
    // direct (voir components/MatchCard.js) : les deux sont visibles ensemble,
    // sans clic ni navigation intermédiaire.
    const card = within(buttons[i].closest("div"));
    expect(card.getByText(f.comp)).toBeInTheDocument();
    expect(card.getByText(f.home)).toBeInTheDocument();
    expect(card.getByText(f.away)).toBeInTheDocument();
    expect(card.getByText(f.score, { exact: true })).toBeInTheDocument();
  });
});

test('"Matchs à venir" : chaque carte affiche compétition + équipes + heure (jamais de score, pas encore joué) + son bouton ANALYSER, tous ensemble sans navigation', async () => {
  render(<UpcomingMatches />);

  const list = await waitFor(() => {
    const el = screen.getByTestId("match-list");
    expect(within(el).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(2);
    return el;
  });

  const fixtures = [
    { comp: "Premier League", home: "Liverpool FC", away: "Manchester City FC" },
    { comp: "Bundesliga", home: "Bayern Munich", away: "Borussia Dortmund" },
  ];

  const buttons = within(list).getAllByRole("button", { name: /^analyser$/i });
  fixtures.forEach((f, i) => {
    const card = within(buttons[i].closest("div"));
    expect(card.getByText(f.comp)).toBeInTheDocument();
    expect(card.getByText(f.home)).toBeInTheDocument();
    expect(card.getByText(f.away)).toBeInTheDocument();
    expect(card.queryByText(/^\d+\s*-\s*\d+$/)).not.toBeInTheDocument();
  });
});

test('cliquer sur ANALYSER depuis une carte précise navigue directement vers le pronostic du bon match, sans détour', async () => {
  render(<Home />);
  const list = await waitFor(() => {
    const el = screen.getByTestId("match-list");
    expect(within(el).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(3);
    return el;
  });

  const buttons = within(list).getAllByRole("button", { name: /^analyser$/i });
  fireEvent.click(buttons[1]); // carte Real Madrid vs Barcelona (id 2)

  expect(pushMock).toHaveBeenCalledTimes(1);
  expect(pushMock.mock.calls[0][0].pathname).toBe("/match/2");
});
