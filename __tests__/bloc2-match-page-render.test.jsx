/**
 * @jest-environment jsdom
 *
 * Vérification "en conditions réelles" (BLOC 2, demandée par le PROMPT : "vérifie
 * ensuite toi-même toutes les pages concernées") : la page d'un match (pages/match/
 * [id].js, components/LiveStatBlock.js, components/CardsAndCorners.js) affiche
 * correctement une VRAIE réponse produite par lib/pronosticFromProfiles.js — y
 * compris "Touches", toujours indisponible avec les profils actuels, qui doit
 * s'afficher proprement ("–"), jamais planter ni afficher "undefined"/"NaN".
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";
import { computeMatchLinesFromProfiles } from "../lib/pronosticFromProfiles";

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

function field(value) {
  return value == null
    ? { value: null, estimated: true, sampleSize: 0, available: false }
    : { value, estimated: false, sampleSize: 6, available: true };
}

function fullSplit(overrides = {}) {
  return {
    goalsFor: field(1.9), goalsAgainst: field(0.7),
    cornersFor: field(6.4), cornersAgainst: field(3.1),
    shots: field(15), shotsOnTarget: field(6.5),
    foulsCommitted: field(9.5), foulsSuffered: field(11.5),
    touches: field(null),
    offsides: field(2.3),
    yellowCards: field(1.8), redCards: field(0.08),
    ...overrides,
  };
}

const REAL_LINES = computeMatchLinesFromProfiles({
  homeProfile: { available: true, home: fullSplit({ goalsFor: field(2.3) }) },
  awayProfile: { available: true, away: fullSplit({ goalsFor: field(0.9) }) },
  homeTeamName: "Real Madrid",
  awayTeamName: "Barcelona",
});

function mockFetch() {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/analyze")) {
      return Promise.resolve({ json: () => Promise.resolve({ ...REAL_LINES, live: false, matchStatus: "SCHEDULED" }) });
    }
    if (url === "/api/match-history") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

beforeEach(() => {
  mockFetch();
  mockRouter = {
    pathname: "/match/777",
    isReady: true,
    replace: jest.fn(),
    query: {
      id: "777", competitionCode: "PD", homeTeamId: "10", awayTeamId: "11",
      homeTeamName: "Real Madrid", awayTeamName: "Barcelona", status: "SCHEDULED",
      minute: "", utcDate: "2026-08-01T20:00:00Z", scoreHome: "", scoreAway: "",
    },
  };
});

test("la page affiche les vraies lignes Bloc 2 (corners/fautes/hors-jeu, mi-temps, tirs, cartons) sans planter", async () => {
  render(<MatchPage />);

  await waitFor(() => expect(screen.getByTestId("stat-corners")).toBeInTheDocument());

  const corners = screen.getByTestId("stat-corners");
  expect(within(corners).getByTestId("stat-corners-total")).toHaveTextContent(/(Plus|Moins) de \d+,5/);
  expect(within(corners).getByTestId("stat-corners-half")).toHaveTextContent("1ère mi-temps");
  expect(within(corners).getByTestId("stat-corners-half")).toHaveTextContent(/(Plus|Moins) de \d+,5/);

  const fouls = screen.getByTestId("stat-fouls");
  expect(within(fouls).getByTestId("stat-fouls-total")).toHaveTextContent(/(Plus|Moins) de \d+,5/);

  const cardsCorners = screen.getByTestId("cards-corners-card");
  expect(within(cardsCorners).getByTestId("market-shots")).toHaveTextContent(/(Plus|Moins) de \d+,5/);
  expect(within(cardsCorners).getByTestId("market-yellow-cards")).toHaveTextContent(/(Plus|Moins) de \d+,5/);

  // Aucun texte cassé nulle part (undefined/NaN), notamment sur le bloc Touches.
  expect(document.body.textContent).not.toMatch(/undefined|NaN/);
});

test("« Touches » (toujours indisponible avec les profils actuels) s'affiche proprement en « – », jamais une valeur cassée", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("stat-throwins")).toBeInTheDocument());

  const touches = screen.getByTestId("stat-throwins");
  expect(within(touches).getByTestId("stat-throwins-total")).toHaveTextContent("–");
  expect(within(touches).getByTestId("stat-throwins-home")).toHaveTextContent("–");
  expect(within(touches).getByTestId("stat-throwins-away")).toHaveTextContent("–");
  expect(within(touches).getByTestId("stat-throwins-half")).toHaveTextContent("–");
});

test("les probabilités 1X2 restent affichées en pourcentage, dans leur propre bloc", async () => {
  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("prob-bar-home")).toBeInTheDocument());
  expect(document.body.textContent).toMatch(/%/);
});
