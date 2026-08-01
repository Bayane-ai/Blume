/**
 * @jest-environment jsdom
 *
 * pages/combine-vision.js — "Combiné Vision" : l'app génère AUTOMATIQUEMENT les
 * combinés à partir des vrais matchs déjà chargés (football via /api/matches et
 * /api/live-matches, déjà munis d'un pronostic réel ; basket/tennis via leurs listes
 * + une analyse automatique bornée, voir MAX_BACKGROUND_ANALYSES_PER_SPORT) —
 * l'utilisateur ne sélectionne rien, les propositions se rafraîchissent
 * régulièrement, et un filtre local permet de voir tous les combinés ou seulement
 * ceux d'un sport (bloc 9).
 */
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import CombineVision from "../pages/combine-vision";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
}));

function pronostic(overrides = {}) {
  const home = overrides.home || { name: "Arsenal FC" };
  return {
    available: true,
    home,
    away: { name: "Chelsea FC" },
    selectionCandidates: [{ marketLabel: "Issue du match", pickLabel: `Victoire ${home.name}`, confidence: 62 }],
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

// BLOC 4.B / BLOC 5 — pages/combine-vision.js enregistre chaque nouveau combiné
// (POST) et relit le taux de réussite/la progression (GET) via /api/combo-history —
// mock par défaut neutre (aucune donnée), overridable via `comboHistoryResponse`.
function comboHistoryHandler(comboHistoryResponse) {
  return (url, options) => {
    if (!url.startsWith("/api/combo-history")) return null;
    if (options?.method === "POST") return Promise.resolve({ json: () => Promise.resolve({ saved: true }) });
    return Promise.resolve({ json: () => Promise.resolve(comboHistoryResponse || { successRates: {}, progress: {} }) });
  };
}

// Football uniquement (basket/tennis vides par défaut) — la plupart des tests
// existants ne portent que sur le football, comme avant le bloc 9.
function mockFetchWithMatches(matches, comboHistoryResponse) {
  const combo = comboHistoryHandler(comboHistoryResponse);
  return jest.fn((url, options) => {
    const comboResult = combo(url, options);
    if (comboResult) return comboResult;
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [{ code: "PL", name: "Premier League", matches }] }) });
    }
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.startsWith("/api/basketball/matches") || url.startsWith("/api/tennis/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    if (url.startsWith("/api/basketball/live-matches") || url.startsWith("/api/tennis/live-matches")) {
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

test("erreur des 6 sources (3 sports x 2) : message d'erreur clair, jamais une page cassée", async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/combo-history")) return Promise.resolve({ json: () => Promise.resolve({ successRates: {}, progress: {} }) });
    return Promise.reject(new Error("réseau indisponible"));
  });

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

// BLOC 3 — "les anciennes propositions dépassées disparaissent ou sont remplacées" :
// une actualisation qui ramène des matchs différents ne doit jamais laisser d'anciens
// combinés (référençant des matchs qui ne sont plus assez sûrs) affichés à l'écran.
test("une actualisation remplace entièrement les anciennes propositions, qui ne restent jamais affichées", async () => {
  let call = 0;
  const combo = comboHistoryHandler();
  global.fetch = jest.fn((url, options) => {
    const comboResult = combo(url, options);
    if (comboResult) return comboResult;
    if (url.startsWith("/api/matches")) {
      call += 1;
      const matches = call === 1
        ? [upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")]
        // Deuxième actualisation : les deux matchs précédents ont disparu du flux
        // (match terminé, par exemple), remplacés par deux matchs différents.
        : [upcomingMatch(3, "Bayern Munich", "Paris Saint-Germain"), upcomingMatch(4, "Liverpool FC", "Manchester City FC")];
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [{ code: "PL", name: "Premier League", matches }] }) });
    }
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.startsWith("/api/basketball/matches") || url.startsWith("/api/tennis/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    if (url.startsWith("/api/basketball/live-matches") || url.startsWith("/api/tennis/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<CombineVision />);
  await waitFor(() => expect(screen.getAllByText(/Arsenal FC/).length).toBeGreaterThan(0));

  const btn = screen.getByRole("button", { name: /actualiser/i });
  await act(async () => {
    btn.click();
  });

  await waitFor(() => expect(screen.getAllByText(/Bayern Munich/).length).toBeGreaterThan(0));
  // Les anciens matchs (première actualisation) ne sont plus référencés nulle part.
  expect(screen.queryAllByText(/Arsenal FC/)).toHaveLength(0);
  expect(screen.queryAllByText(/Real Madrid/)).toHaveLength(0);
});

test("un match en direct assez sûr alimente aussi les combinés (pas seulement les matchs à venir)", async () => {
  const combo = comboHistoryHandler();
  global.fetch = jest.fn((url, options) => {
    const comboResult = combo(url, options);
    if (comboResult) return comboResult;
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
    if (url.startsWith("/api/basketball/matches") || url.startsWith("/api/tennis/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    if (url.startsWith("/api/basketball/live-matches") || url.startsWith("/api/tennis/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<CombineVision />);

  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));
});

// BLOC 4.B — "Suivi dans le temps".
test("enregistre (POST) les combinés fraîchement générés auprès de /api/combo-history", async () => {
  const fetchMock = mockFetchWithMatches([upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")]);
  global.fetch = fetchMock;

  render(<CombineVision />);
  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));

  const postCall = fetchMock.mock.calls.find(([url, options]) => url === "/api/combo-history" && options?.method === "POST");
  expect(postCall).toBeDefined();
  const body = JSON.parse(postCall[1].body);
  expect(Array.isArray(body.combos)).toBe(true);
  expect(body.combos.length).toBeGreaterThan(0);
});

test("affiche le taux de réussite par niveau de risque quand l'historique en a", async () => {
  global.fetch = mockFetchWithMatches(
    [upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")],
    { successRates: { faible: { won: 8, total: 10, pct: 80 } }, progress: {} }
  );

  render(<CombineVision />);

  await waitFor(() => expect(screen.getByTestId("success-rate-faible")).toBeInTheDocument());
  expect(screen.getByTestId("success-rate-faible")).toHaveTextContent("Peu risqué");
  expect(screen.getByTestId("success-rate-faible")).toHaveTextContent("80");
  expect(screen.getByTestId("success-rate-faible")).toHaveTextContent("10 combinés");
  // Autorisé (voir PROMPT : "ce n'est pas une cote") — mais jamais un format de cote.
  expect(screen.getByTestId("success-rate-faible").textContent).not.toMatch(/\b\d\.\d{2}\b/);
});

test("aucun historique disponible : pas de section taux de réussite affichée (jamais une donnée inventée)", async () => {
  global.fetch = mockFetchWithMatches([upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")]);

  render(<CombineVision />);

  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));
  expect(screen.queryByTestId("combo-success-rates")).not.toBeInTheDocument();
});

test("un combiné déjà classé affiche son statut Gagné/Perdu (via /api/combo-history)", async () => {
  let comboIdsSeen = null;
  const fetchMock = jest.fn((url, options) => {
    if (url.startsWith("/api/combo-history")) {
      if (options?.method === "POST") return Promise.resolve({ json: () => Promise.resolve({ saved: true }) });
      const ids = new URL(url, "http://localhost").searchParams.get("ids")?.split(",") || [];
      comboIdsSeen = ids;
      const progress = {};
      if (ids[0]) progress[ids[0]] = { status: "success", legResults: {} };
      return Promise.resolve({ json: () => Promise.resolve({ successRates: {}, progress }) });
    }
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [{ code: "PL", name: "Premier League", matches: [upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")] }] }) });
    }
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.startsWith("/api/basketball/matches") || url.startsWith("/api/tennis/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    if (url.startsWith("/api/basketball/live-matches") || url.startsWith("/api/tennis/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
  global.fetch = fetchMock;

  render(<CombineVision />);

  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));
  await waitFor(() => expect(comboIdsSeen).not.toBeNull());
  await waitFor(() => expect(screen.getAllByText("Gagné").length).toBeGreaterThan(0));
});

// BLOC 5 — "propositions dynamiques" : indicateur visuel clair que la liste n'est
// pas figée.
test("affiche un indicateur clair que les combinés se renouvellent automatiquement", async () => {
  global.fetch = mockFetchWithMatches([upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")]);

  render(<CombineVision />);

  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));
  expect(screen.getByTestId("combined-vision-freshness")).toHaveTextContent(/se renouvelle automatiquement/i);
  // Confirme l'horodatage de la dernière actualisation, pas un texte figé générique.
  expect(screen.getByTestId("combined-vision-freshness")).toHaveTextContent(/mis à jour à/i);
});

// BLOC 9 (multi-sport) — mélange football/basket/tennis : basket/tennis n'ont pas de
// pronostic tout prêt dans leur liste (voir pages/api/basketball/matches.js), c'est
// pages/combine-vision.js qui les analyse automatiquement en arrière-plan (bornée,
// voir MAX_BACKGROUND_ANALYSES_PER_SPORT) avant de générer les combinés.
function basketballUpcomingMatch(id, homeName, awayName) {
  return {
    id, status: "SCHEDULED", utcDate: new Date(Date.now() + 3 * 3600000).toISOString(),
    competition: { code: "nba", name: "NBA", season: "2025-2026" },
    homeTeam: { id: `bk-${id}0`, name: homeName }, awayTeam: { id: `bk-${id}1`, name: awayName },
    score: { fullTime: { home: null, away: null } },
    pronostic: { available: false },
  };
}
function tennisUpcomingMatch(id, homeName, awayName) {
  return {
    id, status: "SCHEDULED", utcDate: new Date(Date.now() + 3 * 3600000).toISOString(),
    competition: { code: "tn-1", name: "Wimbledon", surface: "Gazon", category: "ATP" },
    homeTeam: { id: `tn-${id}0`, name: homeName }, awayTeam: { id: `tn-${id}1`, name: awayName },
    score: { fullTime: { home: null, away: null } },
    pronostic: { available: false },
  };
}
function basketballAnalyzeResult(homeName, awayName) {
  return {
    available: true, home: { name: homeName }, away: { name: awayName },
    selectionCandidates: [{ marketLabel: "Issue du match", pickLabel: `Victoire ${homeName}`, confidence: 62, verify: { type: "winner", key: "home" } }],
  };
}

function mockFetchMultiSport({ football = [], basketball = [], tennis = [] }) {
  const combo = comboHistoryHandler();
  return jest.fn((url, options) => {
    const comboResult = combo(url, options);
    if (comboResult) return comboResult;
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: football.length ? [{ code: "PL", name: "Premier League", matches: football }] : [] }) });
    }
    if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    if (url.startsWith("/api/basketball/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: basketball.length ? [{ code: "nba", name: "NBA", matches: basketball }] : [] }) });
    }
    if (url.startsWith("/api/basketball/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    if (url.startsWith("/api/tennis/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: tennis.length ? [{ code: "tn-1", name: "Wimbledon", matches: tennis }] : [] }) });
    }
    if (url.startsWith("/api/tennis/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    if (url.startsWith("/api/basketball/analyze")) {
      const homeTeamName = new URL(url, "http://localhost").searchParams.get("homeTeamName");
      const awayTeamName = new URL(url, "http://localhost").searchParams.get("awayTeamName");
      return Promise.resolve({ json: () => Promise.resolve(basketballAnalyzeResult(homeTeamName, awayTeamName)) });
    }
    if (url.startsWith("/api/tennis/analyze")) {
      const homeTeamName = new URL(url, "http://localhost").searchParams.get("homeTeamName");
      const awayTeamName = new URL(url, "http://localhost").searchParams.get("awayTeamName");
      return Promise.resolve({ json: () => Promise.resolve(basketballAnalyzeResult(homeTeamName, awayTeamName)) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

test("bloc 9 : analyse automatiquement les matchs basket/tennis en arrière-plan et les mélange aux combinés", async () => {
  global.fetch = mockFetchMultiSport({
    basketball: [basketballUpcomingMatch(1, "Lakers", "Warriors"), basketballUpcomingMatch(2, "Celtics", "Nets")],
  });

  render(<CombineVision />);

  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));
  expect(screen.getAllByText(/Lakers|Celtics/).length).toBeGreaterThan(0);
});

test("bloc 9 : le filtre de sport local ne montre que les combinés touchant le sport choisi", async () => {
  global.fetch = mockFetchMultiSport({
    football: [upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")],
    basketball: [basketballUpcomingMatch(3, "Lakers", "Warriors"), basketballUpcomingMatch(4, "Celtics", "Nets")],
  });

  render(<CombineVision />);
  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));

  expect(screen.getByTestId("combo-sport-filter-tous")).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(screen.getByTestId("combo-sport-filter-basketball"));
  await waitFor(() => expect(screen.getByTestId("combo-sport-filter-basketball")).toHaveAttribute("aria-pressed", "true"));

  const tickets = screen.getAllByTestId("combined-vision-ticket");
  expect(tickets.length).toBeGreaterThan(0);
  for (const ticket of tickets) {
    expect(ticket.textContent).toMatch(/🏀/);
  }
});

function tennisLiveMatch(id, homeName, awayName) {
  return {
    id, status: "IN_PLAY", utcDate: new Date().toISOString(),
    competition: { code: "tn-1", name: "Wimbledon", surface: "Gazon", category: "ATP" },
    homeTeam: { id: `tn-${id}0`, name: homeName }, awayTeam: { id: `tn-${id}1`, name: awayName },
    score: { fullTime: { home: 1, away: 0 } },
    pronostic: { available: false },
  };
}

// Bloc 10 (revue multi-sport) — le tennis est en direct près de 24h/24 dans le monde
// (voir lib/sports/tennis/provider.js) : un pic de matchs en direct ne doit JAMAIS
// déclencher un appel d'analyse par match sans limite, même si tous ces matchs sont
// "en direct" (voir pages/combine-vision.js#selectCandidatesForAnalysis, corrigé pour
// plafonner le total live+à venir, plus seulement les matchs à venir).
test("bloc 10 : un grand nombre de matchs tennis EN DIRECT ne déclenche jamais un nombre illimité d'appels d'analyse automatique", async () => {
  const manyLiveTennisMatches = Array.from({ length: 20 }, (_, i) => tennisLiveMatch(i + 1, `Joueur${i}A`, `Joueur${i}B`));
  const fetchMock = mockFetchMultiSport({ tennis: manyLiveTennisMatches });
  global.fetch = fetchMock;

  render(<CombineVision />);
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/tennis/matches"))).toBe(true));
  // Laisse le temps aux analyses en arrière-plan de se déclencher.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => {
    const analyzeCalls = fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/tennis/analyze"));
    expect(analyzeCalls.length).toBeGreaterThan(0);
  });

  const analyzeCalls = fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/tennis/analyze"));
  expect(analyzeCalls.length).toBeLessThanOrEqual(6);
});

test("bloc 9 : jamais de placeholder « bientôt disponible » sur cette page (elle mélange les 3 sports, indépendamment du sélecteur global)", async () => {
  global.fetch = mockFetchWithMatches([upcomingMatch(1, "Arsenal FC", "Chelsea FC"), upcomingMatch(2, "Real Madrid", "FC Barcelona")]);

  render(<CombineVision />);
  await waitFor(() => expect(screen.getAllByTestId("combined-vision-ticket").length).toBeGreaterThan(0));

  fireEvent.click(screen.getByTestId("sport-tab-basketball"));
  expect(screen.queryByTestId("sport-coming-soon")).not.toBeInTheDocument();
});
