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
