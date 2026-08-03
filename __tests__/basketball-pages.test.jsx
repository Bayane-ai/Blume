/**
 * @jest-environment jsdom
 *
 * Multi-sport bloc 2 — reproduit pour le basket la présentation des matchs football :
 * Live (tous les matchs en direct, toutes ligues confondues, quart-temps + chrono,
 * bouton Analyser dans la carte, actualisation automatique) et Matchs à venir
 * (groupés jour par jour, sans score, bouton Analyser dans la carte) — un clic sur
 * Analyser mène directement à la page pronostics, aucune page intermédiaire.
 */
import { render, screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import Home from "../pages/index";
import UpcomingMatches from "../pages/a-venir";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: pushMock, replace: jest.fn() }),
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
}));

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

function selectBasketball() {
  fireEvent.click(screen.getByTestId("sport-tab-basketball"));
}

beforeEach(() => {
  clearCookies();
  pushMock.mockClear();
});

describe("Live (Basket) — tous les matchs en direct, toutes ligues confondues", () => {
  function liveFixture() {
    return {
      matches: [
        {
          id: "bk-1", status: "IN_PLAY", minute: "5:23", period: "Q3", utcDate: new Date().toISOString(),
          competition: { code: "bk-12", name: "NBA", emblem: "" },
          homeTeam: { id: "bk-10", name: "Lakers", crest: "https://x/lal.png" },
          awayTeam: { id: "bk-11", name: "Warriors", crest: "https://x/gsw.png" },
          score: { fullTime: { home: 75, away: 68 } },
          pronostic: { available: false },
        },
        {
          id: "bk-2", status: "IN_PLAY", minute: "2:00", period: "OT", utcDate: new Date().toISOString(),
          competition: { code: "bk-20", name: "EuroLeague", emblem: "" },
          homeTeam: { id: "bk-30", name: "Real Madrid", crest: "" },
          awayTeam: { id: "bk-31", name: "Barcelona", crest: "" },
          score: { fullTime: { home: 90, away: 88 } },
          pronostic: { available: false },
        },
      ],
    };
  }

  test("affiche logos/noms des deux équipes, la compétition, le score, le quart-temps et le chrono", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
      if (url.startsWith("/api/basketball/live-matches")) return Promise.resolve({ json: () => Promise.resolve(liveFixture()) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
    selectBasketball();

    await waitFor(() => expect(screen.getByText("Lakers")).toBeInTheDocument());
    expect(screen.getByText("Warriors")).toBeInTheDocument();
    expect(screen.getByText("NBA")).toBeInTheDocument();
    expect(screen.getByText("EuroLeague")).toBeInTheDocument();
    expect(screen.getByText("75 - 68")).toBeInTheDocument();
    // Quart-temps + chrono (voir lib/liveClockFormat.js) : "Q3 · 5:23" pour le premier
    // match, "Prolongation · 2:00" pour le second.
    expect(screen.getAllByTestId("card-minute")[0]).toHaveTextContent("Q3 · 5:23");
    expect(screen.getAllByTestId("card-minute")[1]).toHaveTextContent("Prolongation · 2:00");
  });

  test("TOUJOURS affichés par défaut quand il y a des matchs live (jamais de bascule automatique sur « à venir »)", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
      if (url.startsWith("/api/basketball/live-matches")) return Promise.resolve({ json: () => Promise.resolve(liveFixture()) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
    selectBasketball();

    await waitFor(() => expect(screen.getByText("Basket en direct")).toBeInTheDocument());
    // La page reste bien celle du direct (titre "Basket en direct"), pas une redirection.
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("le bouton Analyser (dans la carte, avec marge) mène directement à /match/[id], sans page intermédiaire", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
      if (url.startsWith("/api/basketball/live-matches")) return Promise.resolve({ json: () => Promise.resolve(liveFixture()) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
    selectBasketball();
    await waitFor(() => expect(screen.getByText("Lakers")).toBeInTheDocument());

    const analyzeButtons = screen.getAllByRole("button", { name: /^analyser$/i });
    expect(analyzeButtons).toHaveLength(2);
    fireEvent.click(analyzeButtons[0]);

    expect(pushMock).toHaveBeenCalledTimes(1);
    const [call] = pushMock.mock.calls[0];
    expect(call.pathname).toBe("/match/bk-1");
    expect(call.query.homeTeamName).toBe("Lakers");
    expect(call.query.awayTeamName).toBe("Warriors");
  });

  test("actualisation automatique et continue du score (sans intervention)", async () => {
    jest.useFakeTimers();
    let call = 0;
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/basketball/live-matches")) {
        call += 1;
        const fixture = liveFixture();
        fixture.matches[0].score.fullTime.home = 75 + call; // change à chaque appel
        return Promise.resolve({ json: () => Promise.resolve(fixture) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    render(<Home />);
    await act(async () => {});
    await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
    selectBasketball();
    await act(async () => {});

    const initialCalls = global.fetch.mock.calls.filter(([url]) => url.startsWith("/api/basketball/live-matches")).length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    await act(async () => {
      jest.advanceTimersByTime(21000);
    });
    const callsAfter = global.fetch.mock.calls.filter(([url]) => url.startsWith("/api/basketball/live-matches")).length;
    expect(callsAfter).toBeGreaterThan(initialCalls);
    jest.useRealTimers();
  });

  test("aucun match en direct : message honnête, jamais une erreur", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
      if (url.startsWith("/api/basketball/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
    selectBasketball();

    await waitFor(() => expect(screen.getByText("Aucun match en direct pour ce sport actuellement.")).toBeInTheDocument());
  });
});

describe("Matchs à venir (Basket) — groupés jour par jour, sans score", () => {
  function upcomingFixture() {
    const today = new Date();
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    return {
      competitions: [
        {
          code: "bk-12", name: "NBA", area: "USA",
          matches: [
            {
              id: "bk-100", status: "SCHEDULED", minute: null, period: null, utcDate: today.toISOString(),
              competition: { code: "bk-12", name: "NBA", emblem: "" },
              homeTeam: { id: "bk-1", name: "Celtics", crest: "" },
              awayTeam: { id: "bk-2", name: "Heat", crest: "" },
              score: { fullTime: { home: null, away: null } },
              pronostic: { available: false },
            },
          ],
        },
        {
          code: "bk-20", name: "EuroLeague", area: "Europe",
          matches: [
            {
              id: "bk-200", status: "SCHEDULED", minute: null, period: null, utcDate: tomorrow.toISOString(),
              competition: { code: "bk-20", name: "EuroLeague", emblem: "" },
              homeTeam: { id: "bk-3", name: "Olympiacos", crest: "" },
              awayTeam: { id: "bk-4", name: "Panathinaikos", crest: "" },
              score: { fullTime: { home: null, away: null } },
              pronostic: { available: false },
            },
          ],
        },
      ],
    };
  }

  test("groupe les matchs en sections par jour (Aujourd'hui, Demain), toutes compétitions confondues", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/matches")) return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
      if (url.startsWith("/api/basketball/matches")) return Promise.resolve({ json: () => Promise.resolve(upcomingFixture()) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    render(<UpcomingMatches />);
    await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
    selectBasketball();

    await waitFor(() => expect(screen.getByText("Celtics")).toBeInTheDocument());
    const sections = screen.getAllByTestId("day-section");
    expect(sections).toHaveLength(2);
    expect(within(sections[0]).getByText("Aujourd'hui")).toBeInTheDocument();
    expect(within(sections[0]).getByText("Celtics")).toBeInTheDocument();
    expect(within(sections[1]).getByText("Demain")).toBeInTheDocument();
    expect(within(sections[1]).getByText("Olympiacos")).toBeInTheDocument();
  });

  test("aucun score affiché pour un match pas encore joué : seulement l'heure", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/matches")) return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
      if (url.startsWith("/api/basketball/matches")) return Promise.resolve({ json: () => Promise.resolve(upcomingFixture()) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    render(<UpcomingMatches />);
    await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
    selectBasketball();

    await waitFor(() => expect(screen.getByText("Celtics")).toBeInTheDocument());
    const scores = screen.getAllByTestId("card-score");
    for (const s of scores) {
      expect(s.textContent).not.toMatch(/^\d+ - \d+$/);
    }
  });

  test("le bouton Analyser mène directement à la page du match (aucune page intermédiaire)", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/matches")) return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
      if (url.startsWith("/api/basketball/matches")) return Promise.resolve({ json: () => Promise.resolve(upcomingFixture()) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    render(<UpcomingMatches />);
    await waitFor(() => expect(screen.getByTestId("sport-tab-football")).toBeInTheDocument());
    selectBasketball();
    await waitFor(() => expect(screen.getByText("Celtics")).toBeInTheDocument());

    const analyzeButtons = screen.getAllByRole("button", { name: /^analyser$/i });
    fireEvent.click(analyzeButtons[0]);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0].pathname).toBe("/match/bk-100");
  });
});
