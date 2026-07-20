/**
 * @jest-environment jsdom
 *
 * Bloc 2 — Informations du match : test complet qui vérifie qu'en cliquant sur un
 * match en live :
 * 1) on arrive bien sur la page de CE match précis (pas un autre) ;
 * 2) le score affiché est le VRAI score en direct renvoyé par l'API (jamais figé à
 *    l'instantané pris au moment du clic) ;
 * 3) il se met à jour automatiquement, à plusieurs reprises, sans recharger la page ;
 * 4) le nom des équipes, la compétition et la minute de jeu affichés sont EXACTS —
 *    domicile à gauche, extérieur à droite, jamais inversés/tronqués/approximés —
 *    y compris pour un match dont le score en direct provient d'API-Football
 *    (repli mis en place au bloc 2 du plan précédent, pour les matchs hors des
 *    compétitions couvertes par football-data.org).
 *
 * Limite de cet environnement : aucun accès réseau sortant vers football-data.org ou
 * api-football.com depuis cette sandbox (déjà documenté dans ce projet) — ce test
 * vérifie donc le comportement réel du code face à un réseau simulé, comme le reste
 * de la suite, pas un appel réel à l'API en production.
 */
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import Home from "../pages/index";
import MatchPage from "../pages/match/[id]";

const pushMock = jest.fn();
let mockRouter = { pathname: "/", isReady: true, query: {}, push: pushMock, replace: jest.fn() };
jest.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: "u1", email: "test@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
  },
}));

beforeEach(() => {
  pushMock.mockClear();
});

// ---------------------------------------------------------------------------
// 1) Cliquer sur un match en live mène bien à SA page précise.
// ---------------------------------------------------------------------------
test("cliquer sur un match en direct navigue vers la page de CE match précis, avec ses vraies informations en query", async () => {
  mockRouter = { pathname: "/", isReady: true, query: {}, push: pushMock, replace: jest.fn() };
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({
        json: () => Promise.resolve({
          matches: [
            {
              id: 77, status: "IN_PLAY", minute: 41, utcDate: new Date().toISOString(),
              competition: { code: "PD", name: "LaLiga", emblem: "" },
              homeTeam: { id: 501, name: "Real Sociedad", crest: "" },
              awayTeam: { id: 502, name: "Athletic Club", crest: "" },
              score: { fullTime: { home: 1, away: 1 } },
              pronostic: { available: true, home: {}, away: {}, probabilities: { home: 40, draw: 30, away: 30 }, goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 } },
            },
          ],
        }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<Home />);
  const btn = await screen.findByRole("button", { name: /^analyser$/i });
  fireEvent.click(btn);

  expect(pushMock).toHaveBeenCalledTimes(1);
  const target = pushMock.mock.calls[0][0];
  expect(target.pathname).toBe("/match/77");
  expect(target.query).toEqual(
    expect.objectContaining({
      homeTeamName: "Real Sociedad", awayTeamName: "Athletic Club",
      competitionName: "LaLiga", status: "IN_PLAY", minute: 41,
    })
  );
});

// ---------------------------------------------------------------------------
// 2) Le score affiché est le VRAI score en direct de l'API, jamais figé à
//    l'instantané du clic.
// ---------------------------------------------------------------------------
test("le score affiché vient de l'API, pas de l'instantané pris au moment du clic (même si les deux diffèrent)", async () => {
  mockRouter = {
    pathname: "/match/77", isReady: true, replace: jest.fn(),
    query: {
      id: "77", competitionCode: "PD", homeTeamId: "501", awayTeamId: "502",
      homeTeamName: "Real Sociedad", awayTeamName: "Athletic Club", status: "IN_PLAY",
      // Instantané pris AVANT le but marqué entre le clic et la réponse de l'API.
      minute: "41", utcDate: new Date().toISOString(), scoreHome: "1", scoreAway: "1",
    },
  };

  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve({
        available: true, live: true,
        home: { name: "Real Sociedad" }, away: { name: "Athletic Club" },
        probabilities: { home: 45, draw: 25, away: 30 },
        goals: { expectedHome: 1.4, expectedAway: 1.2, over25: 50, bttsYes: 55 },
        correctScores: [{ score: "2-1", probability: 12 }],
        note: "note",
        matchStatus: "IN_PLAY", matchMinute: 43, matchScore: { home: 2, away: 1 },
      }),
    })
  );

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("live-score")).toHaveTextContent("2 - 1"));
  expect(screen.getByTestId("live-minute")).toHaveTextContent("43’");
});

// ---------------------------------------------------------------------------
// 3) Mise à jour automatique, à plusieurs reprises, sans recharger la page.
// ---------------------------------------------------------------------------
test("le score et la minute se mettent à jour automatiquement sur plusieurs cycles, sans recharger la page", async () => {
  mockRouter = {
    pathname: "/match/77", isReady: true, replace: jest.fn(),
    query: {
      id: "77", competitionCode: "PD", homeTeamId: "501", awayTeamId: "502",
      homeTeamName: "Real Sociedad", awayTeamName: "Athletic Club", status: "IN_PLAY",
      minute: "10", utcDate: new Date().toISOString(), scoreHome: "0", scoreAway: "0",
    },
  };

  let call = 0;
  const cycles = [
    { score: { home: 0, away: 0 }, minute: 10 },
    { score: { home: 1, away: 0 }, minute: 23 },
    { score: { home: 1, away: 1 }, minute: 51 },
    { score: { home: 2, away: 1 }, minute: 78 },
  ];
  global.fetch = jest.fn(() => {
    const cycle = cycles[Math.min(call, cycles.length - 1)];
    call += 1;
    return Promise.resolve({
      json: () => Promise.resolve({
        available: true, live: true,
        home: { name: "Real Sociedad" }, away: { name: "Athletic Club" },
        probabilities: { home: 40, draw: 30, away: 30 },
        goals: { expectedHome: 1, expectedAway: 1, over25: 40, bttsYes: 40 },
        correctScores: [{ score: "1-0", probability: 10 }],
        note: "note",
        matchStatus: "IN_PLAY", matchMinute: cycle.minute, matchScore: cycle.score,
      }),
    });
  });

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("live-score")).toHaveTextContent("0 - 0"));
  expect(screen.getByTestId("live-minute")).toHaveTextContent("10’");

  for (const expected of cycles.slice(1)) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2200));
    });
    await waitFor(() =>
      expect(screen.getByTestId("live-score")).toHaveTextContent(`${expected.score.home} - ${expected.score.away}`)
    );
    expect(screen.getByTestId("live-minute")).toHaveTextContent(`${expected.minute}’`);
  }

  expect(call).toBeGreaterThanOrEqual(cycles.length);
}, 15000);

// ---------------------------------------------------------------------------
// 4) Noms d'équipes, compétition et minute exacts — domicile à gauche, extérieur à
//    droite, jamais inversés ni approximés.
// ---------------------------------------------------------------------------
describe("Bloc 2.4 — équipes / compétition / minute exacts, jamais inversés ni approximés", () => {
  test("noms d'équipes longs et compétition affichés mot pour mot, domicile à gauche / extérieur à droite", async () => {
    mockRouter = {
      pathname: "/match/900", isReady: true, replace: jest.fn(),
      query: {
        id: "900", competitionCode: "CL", homeTeamId: "10", awayTeamId: "20",
        homeTeamName: "Borussia Mönchengladbach", awayTeamName: "Paris Saint-Germain FC",
        competitionName: "Ligue des Champions",
        status: "IN_PLAY", minute: "67", utcDate: new Date().toISOString(),
        scoreHome: "0", scoreAway: "0",
      },
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({
          available: true, live: true,
          home: { name: "Borussia Mönchengladbach" }, away: { name: "Paris Saint-Germain FC" },
          probabilities: { home: 20, draw: 25, away: 55 },
          goals: { expectedHome: 0.8, expectedAway: 2.1, over25: 55, bttsYes: 45 },
          correctScores: [{ score: "0-2", probability: 14 }],
          note: "note",
          matchStatus: "IN_PLAY", matchMinute: 67, matchScore: { home: 0, away: 1 },
        }),
      })
    );

    render(<MatchPage />);

    await waitFor(() => expect(screen.getByTestId("live-score")).toHaveTextContent("0 - 1"));
    expect(screen.getByTestId("live-minute")).toHaveTextContent("67’");

    // Le nom des équipes apparaît aussi dans le texte descriptif plus bas ("X affronte
    // Y en <compétition>") : on se limite ici à l'en-tête (MatchHeaderHero), qui est
    // l'affichage canonique "domicile à gauche / extérieur à droite" attendu par ce test.
    const header = screen.getByTestId("live-score").closest("header");
    expect(within(header).getByText("Ligue des Champions")).toBeInTheDocument();
    const homeName = within(header).getByText("Borussia Mönchengladbach");
    const awayName = within(header).getByText("Paris Saint-Germain FC");
    // Domicile à gauche, extérieur à droite : dans l'ordre du document (mise en page en
    // ligne, sans inversion CSS), le nom de l'équipe à domicile doit précéder celui de
    // l'équipe à l'extérieur.
    expect(homeName.compareDocumentPosition(awayName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("statut PAUSED (mi-temps) : \"MT\" affiché à la place d'un numéro de minute — jamais une minute approximative inventée", async () => {
    mockRouter = {
      pathname: "/match/900", isReady: true, replace: jest.fn(),
      query: {
        id: "900", competitionCode: "CL", homeTeamId: "10", awayTeamId: "20",
        homeTeamName: "Borussia Mönchengladbach", awayTeamName: "Paris Saint-Germain FC",
        competitionName: "Ligue des Champions",
        status: "PAUSED", minute: "45", utcDate: new Date().toISOString(),
        scoreHome: "0", scoreAway: "1",
      },
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({
          available: true, live: true,
          home: { name: "Borussia Mönchengladbach" }, away: { name: "Paris Saint-Germain FC" },
          probabilities: { home: 20, draw: 25, away: 55 },
          goals: { expectedHome: 0.8, expectedAway: 2.1, over25: 55, bttsYes: 45 },
          correctScores: [{ score: "0-2", probability: 14 }],
          note: "note",
          matchStatus: "PAUSED", matchMinute: 45, matchScore: { home: 0, away: 1 },
        }),
      })
    );

    render(<MatchPage />);

    await waitFor(() => expect(screen.getByTestId("live-score")).toHaveTextContent("0 - 1"));
    expect(screen.getByTestId("live-minute")).toHaveTextContent("MT");
  });

  test("un match connu uniquement via API-Football (id préfixé \"af-\") affiche des équipes/compétition/minute tout aussi exacts", async () => {
    mockRouter = {
      pathname: "/match/af-4242", isReady: true, replace: jest.fn(),
      query: {
        id: "af-4242", competitionCode: "af-71", homeTeamId: "af-501", awayTeamId: "af-502",
        homeTeamName: "Santos FC", awayTeamName: "Corinthians", competitionName: "Campeonato Paulista",
        status: "IN_PLAY", minute: "58", utcDate: new Date().toISOString(),
        scoreHome: "2", scoreAway: "2",
      },
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({
          available: true, live: true,
          home: { name: "Santos FC" }, away: { name: "Corinthians" },
          probabilities: { home: 30, draw: 30, away: 40 },
          goals: { expectedHome: 1.5, expectedAway: 1.5, over25: 60, bttsYes: 60 },
          correctScores: [{ score: "2-2", probability: 8 }],
          note: "note",
          matchStatus: "IN_PLAY", matchMinute: 59, matchScore: { home: 2, away: 2 },
        }),
      })
    );

    render(<MatchPage />);

    await waitFor(() => expect(screen.getByTestId("live-minute")).toHaveTextContent("59’"));
    expect(screen.getByTestId("live-score")).toHaveTextContent("2 - 2");

    const header = screen.getByTestId("live-score").closest("header");
    expect(within(header).getByText("Santos FC")).toBeInTheDocument();
    expect(within(header).getByText("Corinthians")).toBeInTheDocument();
    expect(within(header).getByText("Campeonato Paulista")).toBeInTheDocument();
  });
});
