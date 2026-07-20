/**
 * @jest-environment jsdom
 *
 * PROMPT 2 : la navigation du site ne doit avoir QUE deux boutons — « Matchs en
 * ligne » et « Matchs à venir » — chacun menant vers du contenu réel (vraie API),
 * sans lien mort ni page vide, et sans aucun autre bouton de navigation.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import Home from "../pages/index";
import UpcomingMatches from "../pages/a-venir";

// Mutable (préfixe "mock" requis par Jest pour être lu depuis la factory du mock
// ci-dessous) : chaque test simule le pathname de la page qu'il rend.
let mockPathname = "/";
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: mockPathname, push: jest.fn(), replace: jest.fn() }),
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

function liveFixture() {
  return {
    matches: [
      {
        id: 1, status: "IN_PLAY", minute: 30, utcDate: new Date().toISOString(),
        competition: { code: "PL", name: "Premier League", emblem: "" },
        homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
        awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
        score: { fullTime: { home: 2, away: 1 } },
        pronostic: {
          available: true, home: {}, away: {},
          probabilities: { home: 40, draw: 30, away: 30 },
          goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 },
        },
      },
    ],
  };
}

function upcomingFixture() {
  const kickoff = new Date(Date.now() + 2 * 24 * 3600000).toISOString();
  return {
    competitions: [
      {
        code: "PD", name: "LaLiga",
        matches: [
          {
            id: 2, status: "SCHEDULED", minute: null, utcDate: kickoff,
            competition: { code: "PD", name: "LaLiga", emblem: "" },
            homeTeam: { id: 20, name: "Real Madrid", crest: "" },
            awayTeam: { id: 21, name: "Barcelona", crest: "" },
            score: { fullTime: { home: null, away: null } },
            pronostic: {
              available: true, home: {}, away: {},
              probabilities: { home: 40, draw: 30, away: 30 },
              goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 },
            },
          },
        ],
      },
    ],
  };
}

function mockFetchRouter() {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve(liveFixture()) });
    }
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve(upcomingFixture()) });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

beforeEach(() => {
  mockFetchRouter();
});

test('exactement deux boutons de navigation existent : "Live" et "Matchs à venir", et rien d\'autre', async () => {
  mockPathname = "/";
  render(<Home />);

  const nav = await screen.findByTestId("main-nav");
  const links = within(nav).getAllByRole("link");
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveTextContent("Live");
  expect(links[1]).toHaveTextContent("Matchs à venir");
  expect(links[0]).toHaveAttribute("href", "/");
  expect(links[1]).toHaveAttribute("href", "/a-venir");

  // Aucun autre bouton de NAVIGATION (ancien onglet "Tous", ancien onglet
  // "Compétitions" isolé, "Analyse IA") — le bouton "Toutes les compétitions" du
  // carrousel de filtres (PROMPT 6) n'est pas un lien de navigation, c'est un filtre
  // de la liste déjà affichée, donc légitime ici.
  expect(screen.queryByText(/^tous\b/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compétitions", exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /analyse ia/i })).not.toBeInTheDocument();
});

test('"Live" est le bouton actif sur l\'accueil et affiche le vrai match en direct (score exact)', async () => {
  mockPathname = "/";
  render(<Home />);

  await waitFor(() => expect(screen.getAllByText("Arsenal FC").length).toBeGreaterThan(0));
  expect(screen.getAllByText("2 - 1").length).toBeGreaterThan(0);
  // Rien de la page "à venir" ne doit apparaître ici.
  expect(screen.queryByText("Real Madrid")).not.toBeInTheDocument();
});

test('"Matchs à venir" mène à une vraie page (pas un lien mort) affichant le vrai match programmé, sans score', async () => {
  mockPathname = "/a-venir";
  render(<UpcomingMatches />);

  const nav = await screen.findByTestId("main-nav");
  expect(within(nav).getByRole("link", { name: "Matchs à venir" })).toHaveAttribute("href", "/a-venir");

  await waitFor(() => expect(screen.getAllByText("Real Madrid").length).toBeGreaterThan(0));
  expect(screen.getByText("Barcelona")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0);

  // Aucun match en direct de l'autre page, aucun score affiché (pas encore joué).
  expect(screen.queryByText("Arsenal FC")).not.toBeInTheDocument();
  expect(screen.queryByText(/^\d+\s*-\s*\d+$/)).not.toBeInTheDocument();
});

test('"Matchs à venir" affiche un message clair (jamais une page vide) quand l\'API ne renvoie aucun match', async () => {
  mockPathname = "/a-venir";
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<UpcomingMatches />);
  expect(await screen.findByText("Aucun match à venir cette semaine.")).toBeInTheDocument();
  expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
});
