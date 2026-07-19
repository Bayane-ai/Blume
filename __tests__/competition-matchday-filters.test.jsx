/**
 * @jest-environment jsdom
 *
 * PROMPT 6 : des carrousels horizontaux de compétitions et de journées, sur
 * "Matchs en ligne" ET "Matchs à venir". Chaque bouton de compétition filtre la
 * liste sur de vraies données API ; chaque bouton de journée affiche les bons
 * matchs ; aucun bouton vide ou sans effet (chaque option correspond à au moins un
 * vrai match chargé).
 */
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import Home from "../pages/index";
import UpcomingMatches from "../pages/a-venir";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: jest.fn(), replace: jest.fn() }),
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

function liveMatch({ id, compCode, compName, home, away, matchday }) {
  return {
    id, status: "IN_PLAY", minute: 20, utcDate: new Date().toISOString(), matchday,
    competition: { code: compCode, name: compName, emblem: "" },
    homeTeam: { id: id * 10, name: home, crest: "" },
    awayTeam: { id: id * 10 + 1, name: away, crest: "" },
    score: { fullTime: { home: 1, away: 0 } },
    pronostic: basePronostic,
  };
}

// 5 vrais matchs en direct, 3 compétitions, journées réelles distinctes.
function liveMatchesFixture() {
  return {
    matches: [
      liveMatch({ id: 1, compCode: "PL", compName: "Premier League", home: "Arsenal FC", away: "Chelsea FC", matchday: 25 }),
      liveMatch({ id: 2, compCode: "PL", compName: "Premier League", home: "Liverpool FC", away: "Everton FC", matchday: 26 }),
      liveMatch({ id: 3, compCode: "PD", compName: "LaLiga", home: "Real Madrid", away: "Sevilla FC", matchday: 20 }),
      liveMatch({ id: 4, compCode: "CL", compName: "Ligue des Champions", home: "Bayern Munich", away: "Inter Milan", matchday: 5 }),
      liveMatch({ id: 5, compCode: "CL", compName: "Ligue des Champions", home: "Paris Saint-Germain", away: "AC Milan", matchday: 5 }),
    ],
  };
}

function upcomingFixture() {
  const kickoff = new Date(Date.now() + 2 * 24 * 3600000).toISOString();
  return {
    competitions: [
      {
        code: "PL", name: "Premier League",
        matches: [
          { id: 101, status: "SCHEDULED", minute: null, utcDate: kickoff, matchday: 27, competition: { code: "PL", name: "Premier League", emblem: "" }, homeTeam: { id: 1010, name: "Manchester City FC", crest: "" }, awayTeam: { id: 1011, name: "Tottenham Hotspur FC", crest: "" }, score: { fullTime: { home: null, away: null } }, pronostic: basePronostic },
        ],
      },
      {
        code: "BL1", name: "Bundesliga",
        matches: [
          { id: 102, status: "TIMED", minute: null, utcDate: kickoff, matchday: 22, competition: { code: "BL1", name: "Bundesliga", emblem: "" }, homeTeam: { id: 1020, name: "Borussia Dortmund", crest: "" }, awayTeam: { id: 1021, name: "RB Leipzig", crest: "" }, score: { fullTime: { home: null, away: null } }, pronostic: basePronostic },
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
      return Promise.resolve({ json: () => Promise.resolve(upcomingFixture()) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

beforeEach(() => {
  mockFetchRouter();
});

describe('"Matchs en ligne" — carrousels compétitions et journées', () => {
  test("le carrousel de compétitions ne montre que les compétitions réellement présentes, et chaque bouton filtre sur de vraies données", async () => {
    render(<Home />);
    const carousel = await screen.findByTestId("competition-filter");

    // Exactement les 3 compétitions réellement chargées, pas une de plus.
    expect(within(carousel).getByRole("button", { name: "Premier League" })).toBeInTheDocument();
    expect(within(carousel).getByRole("button", { name: "LaLiga" })).toBeInTheDocument();
    expect(within(carousel).getByRole("button", { name: "Ligue des Champions" })).toBeInTheDocument();
    expect(within(carousel).queryByRole("button", { name: "Bundesliga" })).not.toBeInTheDocument();

    // Cliquer "LaLiga" ne garde que le vrai match LaLiga.
    fireEvent.click(within(carousel).getByRole("button", { name: "LaLiga" }));
    const list = screen.getByTestId("match-list");
    await waitFor(() => expect(within(list).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1));
    expect(within(list).getByText("Real Madrid")).toBeInTheDocument();
    expect(within(list).queryByText("Arsenal FC")).not.toBeInTheDocument();
    expect(within(list).queryByText("Bayern Munich")).not.toBeInTheDocument();
  });

  test("le carrousel de journées n'apparaît qu'après avoir choisi une compétition, et chaque bouton affiche les bons matchs", async () => {
    render(<Home />);
    const compCarousel = await screen.findByTestId("competition-filter");

    // Pas de carrousel de journées tant qu'aucune compétition n'est choisie.
    expect(screen.queryByTestId("matchday-filter")).not.toBeInTheDocument();

    fireEvent.click(within(compCarousel).getByRole("button", { name: "Premier League" }));
    const mdCarousel = await screen.findByTestId("matchday-filter");
    expect(within(mdCarousel).getByRole("button", { name: "Journée 25" })).toBeInTheDocument();
    expect(within(mdCarousel).getByRole("button", { name: "Journée 26" })).toBeInTheDocument();
    // Aucune journée d'une autre compétition ne doit apparaître ici.
    expect(within(mdCarousel).queryByRole("button", { name: "Journée 20" })).not.toBeInTheDocument();

    fireEvent.click(within(mdCarousel).getByRole("button", { name: "Journée 26" }));
    const list = screen.getByTestId("match-list");
    await waitFor(() => expect(within(list).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1));
    expect(within(list).getByText("Liverpool FC")).toBeInTheDocument();
    expect(within(list).queryByText("Arsenal FC")).not.toBeInTheDocument();
  });

  test("changer de compétition réinitialise le filtre de journée", async () => {
    render(<Home />);
    const compCarousel = await screen.findByTestId("competition-filter");

    fireEvent.click(within(compCarousel).getByRole("button", { name: "Premier League" }));
    const mdCarousel = await screen.findByTestId("matchday-filter");
    fireEvent.click(within(mdCarousel).getByRole("button", { name: "Journée 25" }));
    await waitFor(() => expect(within(screen.getByTestId("match-list")).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1));

    fireEvent.click(compCarousel.querySelector("button")); // "Toutes les compétitions"
    await waitFor(() => expect(within(screen.getByTestId("match-list")).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(5));
    expect(screen.queryByTestId("matchday-filter")).not.toBeInTheDocument();
  });
});

describe('"Matchs à venir" — carrousels compétitions et journées', () => {
  test("filtrer par compétition puis par journée affiche les bons matchs, avec de vraies données", async () => {
    render(<UpcomingMatches />);
    const compCarousel = await screen.findByTestId("competition-filter");

    expect(within(compCarousel).getByRole("button", { name: "Premier League" })).toBeInTheDocument();
    expect(within(compCarousel).getByRole("button", { name: "Bundesliga" })).toBeInTheDocument();

    fireEvent.click(within(compCarousel).getByRole("button", { name: "Bundesliga" }));
    const list = screen.getByTestId("match-list");
    await waitFor(() => expect(within(list).getByText("Borussia Dortmund")).toBeInTheDocument());
    expect(within(list).queryByText("Manchester City FC")).not.toBeInTheDocument();

    const mdCarousel = await screen.findByTestId("matchday-filter");
    fireEvent.click(within(mdCarousel).getByRole("button", { name: "Journée 22" }));
    await waitFor(() => expect(within(list).getByText("Borussia Dortmund")).toBeInTheDocument());
  });
});
