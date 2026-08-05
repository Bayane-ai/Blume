/**
 * @jest-environment jsdom
 *
 * La navigation du site a exactement cinq boutons — « Live », « Matchs à venir »,
 * « News », « Probabilités réussies » et « Probabilités échouées » — chacun menant vers
 * du contenu réel (vraie API/vraies pages), sans lien mort ni page vide, et sans aucun
 * autre bouton de navigation.
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

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
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
      return Promise.resolve({ ok: true, json: () => Promise.resolve(upcomingFixture()) });
    }
    // SportScore indisponible dans ce test : la source Blume seule doit suffire.
    if (String(url).includes("sportscore")) return Promise.reject(new Error("indisponible"));
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

beforeEach(() => {
  mockFetchRouter();
});

test('les pills de navigation sont exactement, dans cet ordre : "Live", "Matchs à venir", "Combiné Vision", "News", "Historique", "Probabilités réussies", "Probabilités échouées" (+ "Réglages", accès au compte), et rien d\'autre', async () => {
  mockPathname = "/";
  render(<Home />);

  const nav = await screen.findByTestId("main-nav");
  const links = within(nav).getAllByRole("link");
  // Les 7 pills de contenu demandées, dans l'ordre exact, puis "Réglages" — conservé
  // car c'est le seul accès à la page de compte (la retirer la rendrait inatteignable).
  expect(links.map((l) => l.textContent.trim())).toEqual([
    "Live", "Matchs à venir", "Combiné Vision", "News",
    "Historique", "Probabilités réussies", "Probabilités échouées", "Réglages",
  ]);
  expect(links.map((l) => l.getAttribute("href"))).toEqual([
    "/", "/a-venir", "/combine-vision", "/news",
    "/historique", "/probabilites-reussies", "/probabilites-echouees", "/reglages",
  ]);

  // L'onglet "Matchs du jour" a totalement disparu de l'interface (BLOC 1).
  expect(within(nav).queryByText(/matchs du jour/i)).not.toBeInTheDocument();
  expect(nav.querySelector('a[href="/matchs-du-jour"]')).toBeNull();

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
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ competitions: [] }) });
    }
    if (String(url).includes("sportscore")) return Promise.reject(new Error("indisponible"));
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<UpcomingMatches />);
  expect(await screen.findByTestId("upcoming-empty")).toBeInTheDocument();
  expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
});
