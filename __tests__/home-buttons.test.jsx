/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Home from "../pages/index";

// Le bandeau "EN DIRECT" du match phare fait aussi partie du texte accessible de son
// bouton, ce qui peut entrer en collision avec l'onglet "En direct" pour une requête
// par rôle : on borne donc les clics sur les onglets à leur conteneur (identifié via
// le bouton "Tous", sans ambiguïté possible).
function tabsContainer() {
  return screen.getByRole("button", { name: /^tous/i }).parentElement;
}

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

function mockFetchRouter() {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve(liveMatchesFixture()) });
    }
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve(weekMatchesFixture()) });
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

  test('l\'onglet "Tous" mélange direct et à venir ; "En direct" / "À venir" filtrent réellement la liste', async () => {
    render(<Home />);
    // "Tous" (par défaut) : les deux matchs sont dans la liste (2 boutons ANALYSER).
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(2));

    fireEvent.click(within(tabsContainer()).getByRole("button", { name: /^en direct/i }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1));
    // Le match phare (toujours affiché) peut aussi montrer Arsenal FC : on vérifie que
    // Liverpool FC, lui, a bien disparu de la page (liste ET match phare).
    expect(screen.queryByText("Liverpool FC")).not.toBeInTheDocument();

    fireEvent.click(within(tabsContainer()).getByRole("button", { name: /^à venir/i }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1));
    expect(screen.getByText("Liverpool FC")).toBeInTheDocument();
  });

  test('l\'onglet "Compétitions" liste de vraies compétitions, et en choisir une navigue vers sa page dédiée', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0));

    fireEvent.click(within(tabsContainer()).getByRole("button", { name: /^compétitions/i }));
    const champions = await waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: /^ligue des champions/i });
      expect(buttons.length).toBeGreaterThan(0);
      return buttons[0];
    });
    fireEvent.click(champions);

    expect(pushMock).toHaveBeenCalledWith("/competition/CL");
  });

  test("la recherche filtre réellement les matchs, sans bouton factice inactif", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(2));

    const input = screen.getByPlaceholderText(/rechercher une équipe/i);
    expect(screen.queryByRole("button", { name: /^rechercher$/i })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "liverpool" } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1));
    expect(screen.getByText("Liverpool FC")).toBeInTheDocument();

    const clearBtn = screen.getByRole("button", { name: "✕" });
    fireEvent.click(clearBtn);
    expect(input.value).toBe("");
  });

  test("un compte connecté voit son email et un bouton de déconnexion (l'accès n'est plus possible sans compte)", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0));
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
    const analyzeButtons = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /^analyser$/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(analyzeButtons[0]);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0].pathname).toBe("/match/1");
  });

  test('l\'onglet "En direct" affiche un message clair quand aucun match n\'est en direct', async () => {
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
    const enDirect = await screen.findByRole("button", { name: /^en direct/i });
    fireEvent.click(enDirect);
    expect(await screen.findByText("Aucun match en direct actuellement.")).toBeInTheDocument();
  });

  test('le filtre région "Europe" regroupe toutes les ligues européennes (pas seulement les compétitions dont l\'aire vaut littéralement "Europe")', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0));

    fireEvent.click(within(tabsContainer()).getByRole("button", { name: /^compétitions/i }));
    fireEvent.click(screen.getByRole("button", { name: "Europe", exact: true }));

    const list = screen.getByText("Choisis une compétition").closest("section");
    // La Premier League a pour aire "Angleterre", pas "Europe" — elle doit quand même
    // apparaître dans le filtre "Europe".
    expect(within(list).getByText("Premier League")).toBeInTheDocument();
    // La Coupe du Monde ("Monde") ne doit pas apparaître.
    expect(within(list).queryByText("Coupe du Monde")).not.toBeInTheDocument();
  });
});
