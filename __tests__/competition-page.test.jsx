/**
 * @jest-environment jsdom
 *
 * Page d'une compétition (pages/competition/[code].js) : les trois onglets
 * Calendrier / Résultats / Classement ont chacun du vrai contenu (pas de
 * placeholder), et un classement absent (ex : phase à élimination directe)
 * s'affiche proprement au lieu de planter ou de rester vide sans explication.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CompetitionPage from "../pages/competition/[code]";

jest.mock("next/router", () => ({
  useRouter: () => ({ isReady: true, query: { code: "PL" }, replace: jest.fn() }),
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

function mockFetch({ standingsTable = [] } = {}) {
  global.fetch = jest.fn((url) => {
    if (url.includes("view=results")) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            code: "PL", name: "Premier League",
            matches: [{
              id: 5, status: "FINISHED", utcDate: "2026-07-01T15:00:00Z",
              competition: { code: "PL", name: "Premier League" },
              homeTeam: { id: 10, name: "Arsenal FC" }, awayTeam: { id: 11, name: "Chelsea FC" },
              score: { fullTime: { home: 2, away: 1 } },
              pronostic: { available: true, probabilities: { home: 40, draw: 30, away: 30 }, goals: { expectedTotal: 2.5, over25: 40, bttsYes: 40 } },
            }],
          }),
      });
    }
    if (url.includes("/api/competition-matches")) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            code: "PL", name: "Premier League",
            matches: [{
              id: 6, status: "SCHEDULED", utcDate: "2026-07-25T15:00:00Z",
              competition: { code: "PL", name: "Premier League" },
              homeTeam: { id: 12, name: "Liverpool FC" }, awayTeam: { id: 13, name: "Manchester City FC" },
              score: { fullTime: { home: null, away: null } },
              pronostic: { available: true, probabilities: { home: 40, draw: 30, away: 30 }, goals: { expectedTotal: 2.5, over25: 40, bttsYes: 40 } },
            }],
          }),
      });
    }
    if (url.includes("/api/competition-standings")) {
      return Promise.resolve({ json: () => Promise.resolve({ code: "PL", name: "Premier League", table: standingsTable }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

test("l'onglet Calendrier affiche un vrai match à venir avec bouton ANALYSER", async () => {
  mockFetch();
  render(<CompetitionPage />);
  await screen.findByText("Liverpool FC");
  expect(screen.getByRole("button", { name: /^analyser$/i })).toBeInTheDocument();
});

test("l'onglet Résultats affiche un vrai résultat (score final)", async () => {
  mockFetch();
  render(<CompetitionPage />);
  await screen.findByText("Liverpool FC");

  fireEvent.click(screen.getByRole("button", { name: "Résultats" }));
  await screen.findByText("Arsenal FC");
  expect(screen.getByText(/2\s*:\s*1/)).toBeInTheDocument();
});

test("l'onglet Classement affiche le vrai classement", async () => {
  mockFetch({
    standingsTable: [
      { position: 1, points: 25, playedGames: 10, won: 8, draw: 1, lost: 1, goalsFor: 20, goalsAgainst: 10, team: { id: 10, name: "Arsenal FC", crest: "" } },
    ],
  });
  render(<CompetitionPage />);
  await screen.findByText("Liverpool FC");

  fireEvent.click(screen.getByRole("button", { name: "Classement" }));
  await screen.findByText("Arsenal FC");
  expect(screen.getByText("25")).toBeInTheDocument();
});

test("classement indisponible (ex : élimination directe) : message clair, pas de plantage", async () => {
  mockFetch({ standingsTable: [] });
  render(<CompetitionPage />);
  await screen.findByText("Liverpool FC");

  fireEvent.click(screen.getByRole("button", { name: "Classement" }));
  await waitFor(() => expect(screen.getByText(/classement indisponible/i)).toBeInTheDocument());
});
