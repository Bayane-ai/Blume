/**
 * @jest-environment jsdom
 *
 * pages/match/[id].js — dès que l'utilisateur ouvre l'analyse/les pronostics d'un
 * match, il s'ajoute automatiquement en haut de SON historique personnel (voir PROMPT
 * "Historique", lib/matchHistory.js, table Supabase match_history isolée par compte).
 * Rouvrir un match depuis l'historique doit afficher les pronostics sans score s'il n'a
 * pas encore été joué, ou la mention "Match terminé" (avec ses pronostics) s'il l'a été
 * depuis.
 */
import { render, screen, waitFor } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";
import { listMatchHistory } from "../lib/matchHistory";
import { supabase } from "../lib/supabaseClient";

const USER_ID = "user-1";

let mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: {} };
jest.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: "user-1", email: "test@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
    from: jest.fn(),
  },
}));

// Même simulation en mémoire que __tests__/match-history-lib.test.js.
let rows;

function makeFromMock() {
  return jest.fn((table) => {
    if (table !== "match_history") throw new Error(`table inattendue dans le test : ${table}`);
    return {
      upsert: (row, opts) => {
        const conflictCols = (opts?.onConflict || "").split(",");
        const idx = rows.findIndex((r) => conflictCols.every((c) => r[c] === row[c]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
        else rows.push({ ...row });
        return Promise.resolve({ error: null });
      },
      delete: () => {
        const filters = [];
        const builder = {
          eq: (col, val) => { filters.push(["eq", col, val]); return builder; },
          lt: (col, val) => { filters.push(["lt", col, val]); return builder; },
          then: (resolve) => {
            rows = rows.filter((r) => !filters.every(([op, col, val]) => (op === "eq" ? r[col] === val : r[col] < val)));
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return builder;
      },
      select: () => {
        const filters = [];
        let orderCol = null;
        let ascending = true;
        const builder = {
          eq: (col, val) => { filters.push([col, val]); return builder; },
          order: (col, o) => { orderCol = col; ascending = !!o?.ascending; return builder; },
          then: (resolve) => {
            let result = rows.filter((r) => filters.every(([col, val]) => r[col] === val));
            if (orderCol) {
              result = [...result].sort((a, b) => {
                if (a[orderCol] === b[orderCol]) return 0;
                const cmp = a[orderCol] > b[orderCol] ? 1 : -1;
                return ascending ? cmp : -cmp;
              });
            }
            return Promise.resolve({ data: result, error: null }).then(resolve);
          },
        };
        return builder;
      },
    };
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
  supabase.from = makeFromMock();
});

test("ouvrir la page d'un match l'ajoute automatiquement en haut de l'historique", async () => {
  mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: baseQuery() };
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(baseAnalyzeResponse()) }));

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
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(baseAnalyzeResponse()) }));

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
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(baseAnalyzeResponse({ matchStatus: "SCHEDULED" })) }));

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("prob-home")).toHaveTextContent("60 %"));
  expect(screen.queryByTestId("match-finished-tag")).not.toBeInTheDocument();
  expect(screen.queryByTestId("live-score")).not.toBeInTheDocument();
});

test("reconsulter depuis l'historique un match terminé entre-temps : mention \"Match terminé\" avec ses pronostics", async () => {
  mockRouter = { pathname: "/match/777", isReady: true, replace: jest.fn(), query: baseQuery({ status: "SCHEDULED" }) };
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(baseAnalyzeResponse({ matchStatus: "FINISHED", matchScore: { home: 2, away: 0 } })),
    })
  );

  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("match-finished-tag")).toHaveTextContent("Match terminé"));
  expect(screen.getByTestId("prob-home")).toHaveTextContent("60 %");
});
