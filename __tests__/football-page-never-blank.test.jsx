/**
 * @jest-environment jsdom
 *
 * "La page d'accueil ne doit jamais être vide sans explication" : quand
 * /api/live-matches retombe sur sa dernière copie connue (voir lib/liveListCache.js,
 * pages/api/live-matches.js — cache persistant, marqué `stale`), la page affiche ces
 * matchs avec la date de mise à jour plutôt qu'un écran vide ; en échec total (aucun
 * cache disponible), elle affiche le message d'état déjà en place, jamais un blanc.
 */
import { render, screen, waitFor } from "@testing-library/react";
import Home from "../pages/index";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/pronosticHistory", () => ({ maybeSweepFinishedPredictions: jest.fn() }));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { id: "u1", email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
}));

function fdMatch(id) {
  return {
    id,
    status: "IN_PLAY",
    minute: 40,
    utcDate: new Date().toISOString(),
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: id * 10, name: `Home ${id}`, crest: "" },
    awayTeam: { id: id * 10 + 1, name: `Away ${id}`, crest: "" },
    score: { fullTime: { home: 1, away: 0 } },
  };
}

test("données en cache (stale) : les matchs s'affichent quand même, avec la mention de mise à jour — jamais un écran vide", async () => {
  const lastUpdated = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [fdMatch(1)], stale: true, lastUpdated }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<Home />);

  await waitFor(() => expect(screen.getAllByText("Home 1").length).toBeGreaterThan(0));
  expect(screen.getByText(/Données mises à jour/)).toBeInTheDocument();
});

test("échec total (aucun cache, aucune source secondaire) : message d'état lisible affiché, jamais un écran vide sans explication", async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ error: "Erreur API football-data (code 429)" }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<Home />);

  await waitFor(() =>
    expect(screen.getByText("Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.")).toBeInTheDocument()
  );
});
