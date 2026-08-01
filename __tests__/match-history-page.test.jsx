/**
 * @jest-environment jsdom
 *
 * pages/historique.js — liste les matchs consultés par CE COMPTE (lib/matchHistory.js,
 * table match_history, isolée par profile_id — voir
 * supabase/migrations/0008_custom_auth.sql), les plus récents en premier, sans bouton
 * "Analyser", et un message clair quand la liste est vide. L'isolation RÉELLE entre
 * deux comptes (le point important côté sécurité) est vérifiée directement au niveau
 * de la route serveur dans __tests__/match-history-api.test.js — le client ne peut
 * plus jamais spécifier "pour quel compte" écrire, seule la session y répond
 * désormais (voir pages/api/match-history.js), donc ce n'est plus testable en
 * passant un faux userId ici.
 */
import { render, screen } from "@testing-library/react";
import Historique from "../pages/historique";
import { addMatchToHistory } from "../lib/matchHistory";

const USER_ID = "user-1";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/historique", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { id: "user-1", email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
}));

// Simule pages/api/match-history.js EN MÉMOIRE (assez fidèle pour exercer la vraie
// logique client de lib/matchHistory.js : upsert/liste/nettoyage des entrées de plus
// de 10 jours) — toutes les requêtes du test tournent pour la MÊME session ("user-1"),
// exactement comme le fait la vraie route (le profile_id vient de la session, jamais
// du corps de la requête).
let rows;
const EXPIRY_MS = 10 * 24 * 3600 * 1000;

function mockFetch() {
  global.fetch = jest.fn((url, options) => {
    if (url !== "/api/match-history") return Promise.reject(new Error(`URL inattendue : ${url}`));

    if (options?.method === "POST") {
      const { entry } = JSON.parse(options.body);
      const row = { match_id: String(entry.id), home_team_name: entry.homeTeam.name, away_team_name: entry.awayTeam.name, added_at: new Date().toISOString() };
      const idx = rows.findIndex((r) => r.match_id === row.match_id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }

    const cutoff = Date.now() - EXPIRY_MS;
    rows = rows.filter((r) => new Date(r.added_at).getTime() >= cutoff);
    const items = [...rows]
      .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
      .map((r) => ({ id: r.match_id, homeTeam: { name: r.home_team_name }, awayTeam: { name: r.away_team_name } }));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) });
  });
}

function mockNextAddedAt(secondsFromNow) {
  const iso = new Date(Date.now() + secondsFromNow * 1000).toISOString();
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(iso);
}

beforeEach(() => {
  rows = [];
  mockFetch();
});

test("affiche un message clair quand aucun match n'a encore été consulté", async () => {
  render(<Historique />);
  expect(await screen.findByTestId("match-history-empty")).toHaveTextContent("Aucun match consulté pour le moment.");
});

test("affiche une carte par match consulté, le plus récent en premier, sans bouton Analyser", async () => {
  mockNextAddedAt(0);
  await addMatchToHistory(USER_ID, {
    id: 1, status: "SCHEDULED", minute: null, utcDate: "2026-01-01T15:00:00Z",
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
    score: { fullTime: { home: null, away: null } },
  });
  mockNextAddedAt(1);
  await addMatchToHistory(USER_ID, {
    id: 2, status: "FINISHED", minute: 90, utcDate: "2026-01-02T15:00:00Z",
    competition: { code: "PD", name: "LaLiga", emblem: "" },
    homeTeam: { id: 20, name: "Real Madrid", crest: "" },
    awayTeam: { id: 21, name: "Barcelona", crest: "" },
    score: { fullTime: { home: 2, away: 1 } },
  });
  jest.restoreAllMocks();

  render(<Historique />);

  const cards = await screen.findAllByTestId("match-history-card");
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveTextContent("Real Madrid");
  expect(cards[1]).toHaveTextContent("Arsenal FC");
  expect(screen.queryByRole("button", { name: /^analyser$/i })).not.toBeInTheDocument();
});

test("bloc 9 : mélange football/basket/tennis dans la même liste, chacun avec son badge de sport, jamais un placeholder « bientôt disponible »", async () => {
  mockNextAddedAt(0);
  await addMatchToHistory(USER_ID, {
    id: "bk-99", status: "SCHEDULED", minute: null, utcDate: "2026-01-01T15:00:00Z",
    competition: { code: "nba", name: "NBA", emblem: "" },
    homeTeam: { id: "bk-10", name: "Lakers", crest: "" },
    awayTeam: { id: "bk-11", name: "Warriors", crest: "" },
    score: { fullTime: { home: null, away: null } },
  });
  mockNextAddedAt(1);
  await addMatchToHistory(USER_ID, {
    id: "tn-55", status: "SCHEDULED", minute: null, utcDate: "2026-01-02T15:00:00Z",
    competition: { code: "tn-1", name: "Wimbledon", emblem: "" },
    homeTeam: { id: "tn-10", name: "Djokovic", crest: "" },
    awayTeam: { id: "tn-11", name: "Alcaraz", crest: "" },
    score: { fullTime: { home: null, away: null } },
  });
  jest.restoreAllMocks();

  render(<Historique />);

  const cards = await screen.findAllByTestId("match-history-card");
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveTextContent("Djokovic");
  expect(cards[1]).toHaveTextContent("Lakers");
  expect(screen.queryByTestId("sport-coming-soon")).not.toBeInTheDocument();
});
