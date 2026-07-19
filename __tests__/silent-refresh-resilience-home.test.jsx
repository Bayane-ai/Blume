/**
 * @jest-environment jsdom
 *
 * Un incident passager (quota API, réseau) pendant un rafraîchissement automatique en
 * arrière-plan ne doit jamais faire disparaître des matchs déjà affichés à l'écran.
 */
import { render, screen, act } from "@testing-library/react";
import Home from "../pages/index";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
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
  goals: { expectedHome: 1.6, expectedAway: 1.1, expectedTotal: 2.7, over25: 54.3, bttsYes: 58.9 },
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

test("un incident passager pendant l'actualisation silencieuse (direct) ne fait pas disparaître les matchs déjà affichés", async () => {
  let liveCallCount = 0;
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      liveCallCount += 1;
      if (liveCallCount === 1) {
        return Promise.resolve({ json: () => Promise.resolve(liveMatchesFixture()) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ error: "Erreur API football-data (code 429)" }) });
    }
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<Home />);
  await screen.findByText("Arsenal FC");

  // Laisse le temps à au moins un cycle d'actualisation silencieuse (toutes les 2s) de
  // se déclencher et d'échouer.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2200));
  });

  expect(liveCallCount).toBeGreaterThan(1);
  expect(screen.getByText("Arsenal FC")).toBeInTheDocument();
  expect(screen.queryByText(/ne sont pas disponibles/i)).not.toBeInTheDocument();
}, 10000);
