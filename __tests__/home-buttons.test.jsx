/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Home from "../pages/index";

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

let mockSession = { user: { email: "test@example.com" } };

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
  },
}));

const pronostic = {
  available: true,
  home: { name: "Arsenal FC", position: 3, points: 55 },
  away: { name: "Chelsea FC", position: 7, points: 44 },
  probabilities: { home: 48.2, draw: 26.1, away: 25.7 },
  goals: { expectedHome: 1.6, expectedAway: 1.1, over25: 54.3, bttsYes: 58.9 },
  correctScores: [{ score: "1-0", probability: 12.4 }],
  note: "note",
};

function liveMatchesFixture() {
  return {
    matches: [
      {
        id: 1, status: "IN_PLAY", minute: 40, utcDate: new Date().toISOString(),
        competition: { code: "PL", name: "Premier League", emblem: "" },
        homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
        awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
        score: { fullTime: { home: 1, away: 0 } },
        pronostic,
      },
    ],
  };
}

function weekMatchesFixture() {
  const nextWeek = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
  return {
    competitions: [
      {
        code: "PL",
        name: "Premier League",
        matches: [
          {
            id: 2, status: "SCHEDULED", minute: null, utcDate: nextWeek,
            competition: { code: "PL", name: "Premier League", emblem: "" },
            homeTeam: { id: 12, name: "Liverpool FC", crest: "" },
            awayTeam: { id: 13, name: "Manchester City FC", crest: "" },
            score: { fullTime: { home: null, away: null } },
            pronostic,
          },
        ],
      },
    ],
  };
}

function competitionMatchesFixture(code) {
  return {
    code,
    name: "Ligue des Champions",
    matches: [
      {
        id: 99, status: "SCHEDULED", minute: null, utcDate: new Date(Date.now() + 2 * 24 * 3600000).toISOString(),
        competition: { code, name: "Ligue des Champions", emblem: "" },
        homeTeam: { id: 20, name: "Real Madrid", crest: "" },
        awayTeam: { id: 21, name: "Bayern Munich", crest: "" },
        score: { fullTime: { home: null, away: null } },
        pronostic: { available: true, probabilities: { home: 40, draw: 30, away: 30 }, goals: { expectedHome: 1, expectedAway: 1, over25: 40, bttsYes: 40 }, correctScores: [], home: {}, away: {} },
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
      return Promise.resolve({ json: () => Promise.resolve(weekMatchesFixture()) });
    }
    if (url.startsWith("/api/competition-matches")) {
      const code = new URL(url, "http://localhost").searchParams.get("code");
      return Promise.resolve({ json: () => Promise.resolve(competitionMatchesFixture(code)) });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

describe("Page Matchs — chaque bouton est fonctionnel", () => {
  beforeEach(() => {
    mockFetchRouter();
    pushMock.mockClear();
    replaceMock.mockClear();
    mockSession = { user: { email: "test@example.com" } };
  });

  test('les onglets "Matchs en ligne" / "Matchs à venir" changent réellement le contenu affiché', async () => {
    render(<Home />);
    await screen.findByText("Arsenal FC");
    expect(screen.queryByText("Liverpool FC")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /matchs à venir/i }));

    await screen.findByText("Liverpool FC");
    expect(screen.queryByText("Arsenal FC")).not.toBeInTheDocument();
  });

  test('l\'onglet "Compétitions" liste de vraies compétitions, et en choisir une charge ses vrais matchs', async () => {
    render(<Home />);
    await screen.findByText("Arsenal FC");

    fireEvent.click(screen.getByRole("button", { name: /compétitions/i }));
    const champions = await screen.findByRole("button", { name: /ligue des champions/i });
    fireEvent.click(champions);

    await screen.findByText("Real Madrid");
    expect(screen.getByText("Bayern Munich")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/competition-matches?code=CL"));

    fireEvent.click(screen.getByRole("button", { name: "← Compétitions" }));
    expect(await screen.findByRole("button", { name: /ligue des champions/i })).toBeInTheDocument();
  });

  test("la recherche filtre réellement les matchs, sans bouton factice inactif", async () => {
    render(<Home />);
    await screen.findByText("Arsenal FC");

    const input = screen.getByPlaceholderText(/rechercher une équipe/i);
    expect(screen.queryByRole("button", { name: /^rechercher$/i })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "chelsea" } });
    await screen.findByText("Chelsea FC");

    const clearBtn = screen.getByRole("button", { name: "✕" });
    fireEvent.click(clearBtn);
    expect(input.value).toBe("");
  });

  test("un compte connecté voit son email et un bouton de déconnexion (l'accès n'est plus possible sans compte)", async () => {
    render(<Home />);
    await screen.findByText("Arsenal FC");
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /déconnexion/i })).toBeInTheDocument();
  });

  test("sans session, la page redirige vers /login au lieu d'afficher les matchs", async () => {
    mockSession = null;

    render(<Home />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Arsenal FC")).not.toBeInTheDocument();
  });

  test('le bouton "ANALYSER" de chaque carte mène vers la page des pronostics de ce match', async () => {
    render(<Home />);
    await screen.findByText("Arsenal FC");

    const analyzeButtons = screen.getAllByRole("button", { name: /^analyser$/i });
    expect(analyzeButtons.length).toBeGreaterThan(0);
    fireEvent.click(analyzeButtons[0]);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0].pathname).toBe("/match/1");
  });

  test('l\'onglet "Matchs en ligne" affiche un message clair quand aucun match n\'est en direct', async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) {
        return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
      }
      if (url.startsWith("/api/matches")) {
        return Promise.resolve({ json: () => Promise.resolve(weekMatchesFixture()) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    render(<Home />);
    expect(await screen.findByText("Aucun match en direct actuellement.")).toBeInTheDocument();
  });
});
