/**
 * @jest-environment jsdom
 *
 * pages/historique.js — liste les matchs consultés par CE COMPTE (lib/matchHistory.js,
 * table Supabase match_history isolée par Row Level Security), les plus récents en
 * premier, sans bouton "Analyser", et un message clair quand la liste est vide.
 */
import { render, screen } from "@testing-library/react";
import Historique from "../pages/historique";
import { addMatchToHistory } from "../lib/matchHistory";
import { supabase } from "../lib/supabaseClient";

const USER_ID = "user-1";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/historique", push: jest.fn(), replace: jest.fn() }),
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

// Même simulation en mémoire que __tests__/match-history-lib.test.js — assez fidèle à
// supabase-js pour exercer la vraie logique de lib/matchHistory.js (upsert/select/delete
// avec filtres).
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

function mockNextAddedAt(secondsFromNow) {
  const iso = new Date(Date.now() + secondsFromNow * 1000).toISOString();
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(iso);
}

beforeEach(() => {
  rows = [];
  supabase.from = makeFromMock();
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

test("l'historique d'un autre compte n'apparaît jamais ici (isolation par utilisateur)", async () => {
  await addMatchToHistory("un-autre-compte", {
    id: 99, status: "SCHEDULED", minute: null, utcDate: "2026-01-01T15:00:00Z",
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 90, name: "Équipe Autrui", crest: "" },
    awayTeam: { id: 91, name: "Adversaire Autrui", crest: "" },
    score: { fullTime: { home: null, away: null } },
  });

  render(<Historique />);
  expect(await screen.findByTestId("match-history-empty")).toBeInTheDocument();
  expect(screen.queryByText("Équipe Autrui")).not.toBeInTheDocument();
});
