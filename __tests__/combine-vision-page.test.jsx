/**
 * @jest-environment jsdom
 *
 * pages/combine-vision.js — "Combiné Vision" : l'app génère AUTOMATIQUEMENT les
 * combinés à partir des vrais matchs déjà chargés par /api/matches et
 * /api/live-matches (chacun déjà muni d'un pronostic réel) — l'utilisateur ne
 * sélectionne rien, et les propositions se rafraîchissent régulièrement.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import CombineVision from "../pages/combine-vision";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn() }),
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

function pronostic(overrides = {}) {
  return {
    available: true,
    home: { name: "Arsenal FC" },
    away: { name: "Chelsea FC" },
    selectionCandidates: [{ marketLabel: "Issue du match", pickLabel: "Victoire Arsenal FC", confidence: 62 }],
    ...overrides,
  };
}

function upcomingMatch(id, homeName, awayName, overrides = {}) {
  return {
    id, status: "SCHEDULED", utcDate: new Date(Date.now() + 3 * 3600000).toISOString(),
    competition: { code: "PL", name: "Premier League" },
    homeTeam: { id: id * 10, name: homeName }, awayTeam: { id: id * 10 + 1, name: awayName },
    score: { fullTime: { home: null, away: null } },
    pronostic: pronostic({ home: { name: homeName }, away: { name: awayName } }),
    ...overrides,
  };
}

function mockFetchWithMatches(matches) {
  return jest.fn((url) => {
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [{ code: "PL", name: "Premier League", matches }] }) });
    }
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

test("affiche des combinés assemblés à partir des vrais matchs chargés, chacun avec ses sélections et sa confiance", async () => {
  global.fetch = mockFetchWithMatches([
    upcomingMatch(1, "Arsenal FC", "Chelsea FC"),
    upcomingMatch(2, "Real Madrid", "FC Barcelona"),
    upcomingMatch(3, "Bayern Munich", "Paris Saint-Germain"),
  ]);

  render(<CombineVision />);

  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));
  expect(screen.getAllByTestId("ticket-leg").length).toBeGreaterThan(0);
  expect(screen.getAllByTestId("ticket-confidence").length).toBeGreaterThan(0);
});

test("pas assez de pronostics assez sûrs : message clair, jamais un combiné inventé", async () => {
  global.fetch = mockFetchWithMatches([
    upcomingMatch(1, "Arsenal FC", "Chelsea FC", {
      pronostic: pronostic({ selectionCandidates: [{ marketLabel: "Issue du match", pickLabel: "Victoire Arsenal FC", confidence: 36 }] }),
    }),
  ]);

  render(<CombineVision />);

  await waitFor(() => expect(screen.getByTestId("combined-vision-empty")).toBeInTheDocument());
  expect(screen.queryByTestId("combined-vision-ticket")).not.toBeInTheDocument();
});

test("erreur des deux sources : message d'erreur clair, jamais une page cassée", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("réseau indisponible")));

  render(<CombineVision />);

  await waitFor(() => expect(screen.getByText(/pas disponibles pour le moment/i)).toBeInTheDocument());
});

test("le bouton \"Actualiser\" déclenche un nouveau chargement", async () => {
  const fetchMock = mockFetchWithMatches([upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")]);
  global.fetch = fetchMock;

  render(<CombineVision />);
  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));

  const callsBefore = fetchMock.mock.calls.length;
  const btn = screen.getByRole("button", { name: /actualiser/i });
  await act(async () => {
    btn.click();
  });

  await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
});

test("les combinés se rafraîchissent automatiquement, sans action de la personne", async () => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  const fetchMock = mockFetchWithMatches([upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")]);
  global.fetch = fetchMock;

  render(<CombineVision />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));

  const callsBefore = fetchMock.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(45200);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  jest.useRealTimers();
});

test("un match en direct assez sûr alimente aussi les combinés (pas seulement les matchs à venir)", async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({
        json: () => Promise.resolve({
          matches: [
            { id: 901, status: "IN_PLAY", minute: 40, utcDate: new Date().toISOString(), competition: { code: "PL", name: "Premier League" }, homeTeam: { id: 10, name: "Arsenal FC" }, awayTeam: { id: 11, name: "Chelsea FC" }, score: { fullTime: { home: 1, away: 0 } }, pronostic: pronostic() },
            { id: 902, status: "IN_PLAY", minute: 20, utcDate: new Date().toISOString(), competition: { code: "PD", name: "LaLiga" }, homeTeam: { id: 20, name: "Real Madrid" }, awayTeam: { id: 21, name: "FC Barcelona" }, score: { fullTime: { home: 0, away: 0 } }, pronostic: pronostic({ home: { name: "Real Madrid" }, away: { name: "FC Barcelona" } }) },
          ],
        }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<CombineVision />);

  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));
});
