/**
 * @jest-environment jsdom
 *
 * pages/match/[id].js — dès que l'utilisateur ouvre l'analyse/les pronostics d'un
 * match, il s'ajoute automatiquement en haut de SON historique personnel (voir PROMPT
 * "Historique", lib/matchHistory.js, table match_history isolée par profile_id — voir
 * supabase/migrations/0008_custom_auth.sql). Rouvrir un match depuis l'historique doit
 * afficher les pronostics sans score s'il n'a pas encore été joué, ou la mention
 * "Match terminé" (avec ses pronostics) s'il l'a été depuis.
 */
import { render, screen, waitFor } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";
import { listMatchHistory } from "../lib/matchHistory";

const USER_ID = "user-1";

let mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: {} };
jest.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { id: "user-1", email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
}));

// Simule EN MÉMOIRE à la fois /api/analyze (réponse configurable par test) et
// /api/match-history (assez fidèle pour exercer la vraie logique client de
// lib/matchHistory.js : upsert/liste, sans doublon) — les deux passent désormais par
// le même global.fetch, routé par URL.
let rows;
let analyzeResponse;

function mockFetch() {
  global.fetch = jest.fn((url, options) => {
    if (url.startsWith("/api/analyze")) {
      return Promise.resolve({ json: () => Promise.resolve(analyzeResponse) });
    }
    if (url === "/api/match-history") {
      if (options?.method === "POST") {
        const { entry } = JSON.parse(options.body);
        const row = { match_id: String(entry.id), home_team_name: entry.homeTeam.name, away_team_name: entry.awayTeam.name, added_at: new Date().toISOString() };
        const idx = rows.findIndex((r) => r.match_id === row.match_id);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
        else rows.push(row);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      const items = [...rows]
        .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
        .map((r) => ({ id: r.match_id, homeTeam: { name: r.home_team_name }, awayTeam: { name: r.away_team_name } }));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

function baseQuery(overrides = {}) {
  return {
    id: "777", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11",
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", status: "SCHEDULED",
    minute: "", utcDate: "2026-01-01T15:00:00Z", scoreHome: "", scoreAway: "",
    ...overrides,
  };
}

function baseAnalyzeResponse(overrides = {}) {
  return {
    available: true, live: false,
    home: { name: "Arsenal FC", position: 3, points: 55 },
    away: { name: "Chelsea FC", position: 7, points: 44 },
    probabilities: { home: 60, draw: 25, away: 15 },
    goals: { expectedHome: 1.6, expectedAway: 1.1, over25: 54, bttsYes: 58 },
    correctScores: [{ score: "2-0", probability: 15 }],
    markets: {},
    matchStats: {},
    note: "note",
    matchStatus: "SCHEDULED",
    ...overrides,
  };
}

beforeEach(() => {
  rows = [];
  analyzeResponse = baseAnalyzeResponse();
  mockFetch();
});

test("ouvrir la page d'un match l'ajoute automatiquement en haut de l'historique", async () => {
  mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: baseQuery() };

  render(<MatchPage />);

  await waitFor(async () => {
    const list = await listMatchHistory(USER_ID);
    expect(list).toHaveLength(1);
  });
  const list = await listMatchHistory(USER_ID);
  expect(list[0].id).toBe("777");
  expect(list[0].homeTeam.name).toBe("Arsenal FC");
  expect(list[0].awayTeam.name).toBe("Chelsea FC");
});

test("ouvrir un match déjà présent dans l'historique le remonte en haut sans créer de doublon", async () => {
  mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: baseQuery({ id: "1" }) };
  const { unmount } = render(<MatchPage />);
  await waitFor(async () => expect(await listMatchHistory(USER_ID)).toHaveLength(1));
  unmount();

  mockRouter = {
    pathname: "/match/2", isReady: true, replace: jest.fn(),
    query: baseQuery({ id: "2", homeTeamName: "Real Madrid", awayTeamName: "Barcelona", homeTeamId: "20", awayTeamId: "21" }),
  };
  const second = render(<MatchPage />);
  await waitFor(async () => expect(await listMatchHistory(USER_ID)).toHaveLength(2));
  second.unmount();

  mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: baseQuery({ id: "1" }) };
  render(<MatchPage />);
  await waitFor(async () => {
    const list = await listMatchHistory(USER_ID);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("1");
  });
});

test("reconsulter depuis l'historique un match pas encore joué : pronostics affichés, sans score, jamais \"Match terminé\"", async () => {
  mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: baseQuery() };
  analyzeResponse = baseAnalyzeResponse({ matchStatus: "SCHEDULED" });

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("prob-home")).toHaveTextContent("60 %"));
  expect(screen.queryByTestId("match-finished-tag")).not.toBeInTheDocument();
  expect(screen.queryByTestId("live-score")).not.toBeInTheDocument();
});

test("reconsulter depuis l'historique un match terminé entre-temps : mention \"Match terminé\" avec ses pronostics", async () => {
  mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: baseQuery({ status: "SCHEDULED" }) };
  analyzeResponse = baseAnalyzeResponse({ matchStatus: "FINISHED", matchScore: { home: 2, away: 0 } });

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("match-finished-tag")).toHaveTextContent("Match terminé"));
  expect(screen.getByTestId("prob-home")).toHaveTextContent("60 %");
});
