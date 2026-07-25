/**
 * @jest-environment jsdom
 *
 * Page "Matchs en ligne" (accueil) : chaque bouton qui lui reste (recherche,
 * ANALYSER, connexion/déconnexion) doit être réellement fonctionnel. La navigation à
 * deux boutons elle-même (PROMPT 2) est vérifiée dans nav-two-buttons.test.jsx.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Home from "../pages/index";

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: pushMock, replace: replaceMock }),
}));

let mockSession = { email: "test@example.com" };

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: mockSession,
    sessionChecked: true,
    authorized: Boolean(mockSession),
  }),
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
      {
        id: 2, status: "IN_PLAY", minute: 12, utcDate: new Date().toISOString(),
        competition: { code: "PD", name: "LaLiga", emblem: "" },
        homeTeam: { id: 20, name: "Real Madrid", crest: "" },
        awayTeam: { id: 21, name: "Barcelona", crest: "" },
        score: { fullTime: { home: 0, away: 0 } },
        pronostic,
      },
    ],
  };
}

function mockFetchRouter() {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve(liveMatchesFixture()) });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

describe("Page Matchs en ligne — chaque bouton restant est fonctionnel", () => {
  beforeEach(() => {
    mockFetchRouter();
    pushMock.mockClear();
    replaceMock.mockClear();
    mockSession = { email: "test@example.com" };
  });

  test("la recherche filtre réellement les matchs, sans bouton factice inactif", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(2));

    const input = screen.getByPlaceholderText(/rechercher une équipe/i);
    expect(screen.queryByRole("button", { name: /^rechercher$/i })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "real madrid" } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1));
    // Le match phare, décorrélé de la recherche par conception, peut continuer à
    // montrer Arsenal FC : on vérifie que la LISTE, elle, est bien filtrée.
    const list = screen.getByTestId("match-list");
    expect(within(list).getByText("Real Madrid")).toBeInTheDocument();
    expect(within(list).queryByText("Arsenal FC")).not.toBeInTheDocument();

    const clearBtn = screen.getByRole("button", { name: "✕" });
    fireEvent.click(clearBtn);
    expect(input.value).toBe("");
  });

  test("un compte connecté voit son email (pas encore de pseudo) et un bouton \"Se déconnecter\" (l'accès n'est plus possible sans compte)", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0));
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /se déconnecter/i })).toBeInTheDocument();
  });

  // Bloc 3 : sans session, jamais la liste des matchs affichée (la redirection
  // effective vers /connexion elle-même est vérifiée de bout en bout, pour TOUTES
  // les pages protégées, par __tests__/all-pages-protected.test.jsx — useRequireAuth
  // est mocké ici, ce test-ci ne couvre que le comportement OBSERVABLE de cette page
  // quand elle n'est pas autorisée).
  test("sans session, jamais la liste des matchs affichée", async () => {
    mockSession = null;

    render(<Home />);

    expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
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

  test("aucun match en direct : message clair, pas de carte fictive", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) {
        return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    render(<Home />);
    expect(await screen.findByText("Aucun match en direct actuellement.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
  });
});
