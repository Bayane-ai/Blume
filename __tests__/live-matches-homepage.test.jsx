/**
 * @jest-environment jsdom
 *
 * PROMPT 1 : la page d'accueil doit afficher TOUS les matchs actuellement en direct
 * renvoyés par la vraie API football-data.org (toutes ligues confondues), avec le
 * vrai score exact, sans aucun match fictif ni plafond artificiel, et se rafraîchir
 * automatiquement sans rechargement de page.
 */
import { render, screen, waitFor, act, within } from "@testing-library/react";
import Home from "../pages/index";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: jest.fn(), replace: jest.fn() }),
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

const COMPETITION_NAMES = [
  "Premier League", "LaLiga", "Serie A", "Bundesliga", "Ligue 1", "Ligue des Champions",
  "Primeira Liga", "Eredivisie", "Championship", "Campeonato Brasileiro Série A",
  "Coupe du Monde", "Euro (Championnat d'Europe)",
];

// 18 matchs en direct, répartis sur toutes les compétitions couvertes par Blume,
// avec des scores réels variés (pas tous 0-0/1-0) — représentatif d'un vrai payload
// football-data.org un soir chargé.
function realisticLiveMatchesFixture(count = 18) {
  const matches = [];
  for (let i = 0; i < count; i++) {
    const compName = COMPETITION_NAMES[i % COMPETITION_NAMES.length];
    const home = i * 2 % 5; // scores variés, jamais tous identiques
    const away = (i * 3 + 1) % 4;
    matches.push({
      id: 1000 + i,
      status: "IN_PLAY",
      minute: 10 + (i % 80),
      utcDate: new Date().toISOString(),
      competition: { code: `C${i}`, name: compName, emblem: "" },
      homeTeam: { id: 2000 + i, name: `Équipe Domicile ${i}`, crest: "" },
      awayTeam: { id: 3000 + i, name: `Équipe Extérieur ${i}`, crest: "" },
      score: { fullTime: { home, away } },
      pronostic: {
        available: true,
        home: { name: `Équipe Domicile ${i}` }, away: { name: `Équipe Extérieur ${i}` },
        probabilities: { home: 40, draw: 30, away: 30 },
        goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 },
      },
    });
  }
  return matches;
}

function mockFetchWith(liveMatches) {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: liveMatches }) });
    }
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

test("affiche TOUS les matchs en direct renvoyés par l'API (18 ici), toutes compétitions confondues, sans aucun plafond", async () => {
  const fixture = realisticLiveMatchesFixture(18);
  mockFetchWith(fixture);

  render(<Home />);

  const list = await waitFor(() => {
    const el = screen.getByTestId("match-list");
    expect(within(el).getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0);
    return el;
  });

  // Un bouton ANALYSER par match affiché dans la liste (le match phare, lui, n'a pas
  // de bouton ANALYSER propre — c'est le même match que le premier de la liste).
  expect(within(list).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(18);

  // Chaque compétition couverte apparaît bien (aucune ligue oubliée/tronquée).
  for (const name of COMPETITION_NAMES) {
    expect(within(list).getAllByText(name).length).toBeGreaterThan(0);
  }
});

test("le score affiché est exactement le vrai score renvoyé par l'API pour chaque match", async () => {
  const fixture = [
    {
      id: 1, status: "IN_PLAY", minute: 55, utcDate: new Date().toISOString(),
      competition: { code: "PL", name: "Premier League", emblem: "" },
      homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
      awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
      score: { fullTime: { home: 0, away: 2 } },
      pronostic: { available: true, home: {}, away: {}, probabilities: { home: 1, draw: 1, away: 98 }, goals: { expectedHome: 0.5, expectedAway: 2.5, expectedTotal: 3, over25: 60, bttsYes: 40 } },
    },
  ];
  mockFetchWith(fixture);

  render(<Home />);
  await waitFor(() => expect(screen.getAllByText("0 : 2").length).toBeGreaterThan(0));
  expect(screen.queryByText("2 : 0")).not.toBeInTheDocument();
});

test("aucun match fictif : la page n'affiche que ce que l'API a réellement renvoyé, jamais plus", async () => {
  mockFetchWith([]);
  render(<Home />);

  await waitFor(() => expect(screen.getByText("Aucun match en direct actuellement.")).toBeInTheDocument());
  expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
});

test("se rafraîchit automatiquement (sans rechargement) : un nouveau score apparaît au cycle suivant", async () => {
  let call = 0;
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      call += 1;
      const score = call === 1 ? { home: 0, away: 0 } : { home: 1, away: 0 };
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            matches: [{
              id: 1, status: "IN_PLAY", minute: 10 + call, utcDate: new Date().toISOString(),
              competition: { code: "PL", name: "Premier League", emblem: "" },
              homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
              awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
              score: { fullTime: score },
              pronostic: { available: true, home: {}, away: {}, probabilities: { home: 40, draw: 30, away: 30 }, goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 } },
            }],
          }),
      });
    }
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<Home />);
  await waitFor(() => expect(screen.getAllByText("0 : 0").length).toBeGreaterThan(0));

  await act(async () => {
    await new Promise((r) => setTimeout(r, 2200)); // laisse un cycle de 2s se déclencher
  });

  expect(call).toBeGreaterThan(1);
  expect(screen.getAllByText("1 : 0").length).toBeGreaterThan(0);
}, 10000);
