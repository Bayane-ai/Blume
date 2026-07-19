/**
 * @jest-environment jsdom
 *
 * Page d'un match : forme récente (badges colorés), coup d'envoi/stade/arbitre —
 * chaque champ manquant doit afficher "Indisponible" au lieu de rester vide ou de
 * planter.
 */
import { render, screen, waitFor } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";

const mockQuery = {
  id: "1", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11",
  homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", status: "SCHEDULED",
  utcDate: "2026-07-25T15:00:00Z",
};

jest.mock("next/router", () => ({
  useRouter: () => ({ isReady: true, query: mockQuery, replace: jest.fn() }),
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

function pronosticFixture({ venue, referee } = {}) {
  return {
    available: true,
    live: false,
    home: { name: "Arsenal FC", position: 3, points: 55, form: "WWDLW" },
    away: { name: "Chelsea FC", position: 7, points: 44, form: "LWDDL" },
    probabilities: { home: 40, draw: 30, away: 30 },
    goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 },
    venue: venue ?? null,
    referee: referee ?? null,
  };
}

test("la forme récente des deux équipes s'affiche en badges (5 lettres chacune)", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(pronosticFixture()) }));
  render(<MatchPage />);

  await waitFor(() => expect(screen.getAllByText("W").length).toBeGreaterThan(0));
  expect(screen.getAllByText("W").length).toBe(4); // 3x dans Arsenal (WWDLW), 1x dans Chelsea (LWDDL)
  expect(screen.getAllByText("L").length).toBe(3); // 1x Arsenal, 2x Chelsea
});

test("stade et arbitre indisponibles s'affichent proprement (jamais vides)", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(pronosticFixture()) }));
  render(<MatchPage />);

  await waitFor(() => expect(screen.getAllByText("Indisponible").length).toBe(2));
});

test("stade et arbitre réels s'affichent quand l'API les fournit", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(pronosticFixture({ venue: "Emirates Stadium", referee: "Michael Oliver" })) })
  );
  render(<MatchPage />);

  await screen.findByText("Emirates Stadium");
  expect(screen.getByText("Michael Oliver")).toBeInTheDocument();
});
