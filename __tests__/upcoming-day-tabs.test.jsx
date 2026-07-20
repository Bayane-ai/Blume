/**
 * @jest-environment jsdom
 *
 * "Matchs à venir" — affichage jour par jour : regroupement par date, barre de
 * sélection d'au moins 7 jours (Aujourd'hui/Demain/jours suivants), un seul jour
 * affiché à la fois, matchs triés par heure de coup d'envoi avec les matchs en
 * direct de ce jour en premier, toutes compétitions confondues (aucun filtre par
 * compétition), et "Aucun match ce jour" pour un jour sans match.
 */
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import UpcomingMatches from "../pages/a-venir";
import { localDayKey } from "../lib/dayGrouping";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/a-venir", push: jest.fn(), replace: jest.fn() }),
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

const basePronostic = {
  available: true, home: {}, away: {},
  probabilities: { home: 40, draw: 30, away: 30 },
  goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 },
};

function match({ id, hoursFromNow, status = "SCHEDULED", compCode, compName, home, away }) {
  return {
    id, status, minute: status === "IN_PLAY" || status === "PAUSED" ? 30 : null,
    utcDate: new Date(Date.now() + hoursFromNow * 3600000).toISOString(),
    competition: { code: compCode, name: compName, emblem: "" },
    homeTeam: { id: id * 10, name: home, crest: "" },
    awayTeam: { id: id * 10 + 1, name: away, crest: "" },
    score: { fullTime: { home: status === "IN_PLAY" ? 1 : null, away: status === "IN_PLAY" ? 0 : null } },
    pronostic: basePronostic,
  };
}

// Matchs répartis sur 3 jours distincts, plusieurs compétitions et pays, un match en
// direct aujourd'hui — comme une vraie soirée de championnats.
function fixture() {
  return {
    competitions: [
      {
        code: "PL", name: "Premier League",
        matches: [
          match({ id: 1, hoursFromNow: 6, compCode: "PL", compName: "Premier League", home: "Liverpool FC", away: "Arsenal FC" }),
          match({ id: 2, hoursFromNow: 2, compCode: "PL", compName: "Premier League", home: "Chelsea FC", away: "Everton FC" }),
        ],
      },
      {
        code: "BSA", name: "Campeonato Brasileiro Série A",
        matches: [
          match({ id: 3, hoursFromNow: -0.5, status: "IN_PLAY", compCode: "BSA", compName: "Campeonato Brasileiro Série A", home: "Flamengo", away: "Palmeiras" }),
        ],
      },
      {
        code: "CL", name: "Ligue des Champions",
        matches: [
          match({ id: 4, hoursFromNow: 26, compCode: "CL", compName: "Ligue des Champions", home: "Bayern Munich", away: "Real Madrid" }),
        ],
      },
      {
        code: "WC", name: "Coupe du Monde",
        matches: [
          match({ id: 5, hoursFromNow: 50, compCode: "WC", compName: "Coupe du Monde", home: "France", away: "Brazil" }),
        ],
      },
    ],
  };
}

function mockFetchWith(data) {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/matches")) return Promise.resolve({ json: () => Promise.resolve(data) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

test("la barre de jours affiche au moins 7 jours, \"Aujourd'hui\" mis en évidence par défaut", async () => {
  mockFetchWith(fixture());
  render(<UpcomingMatches />);

  const tabs = await screen.findByTestId("day-tabs");
  const buttons = within(tabs).getAllByRole("button");
  expect(buttons.length).toBeGreaterThanOrEqual(7);
  expect(buttons[0]).toHaveTextContent("Aujourd'hui");
  expect(buttons[1]).toHaveTextContent("Demain");
  // Bouton actif visuellement distinct (fond vert plein, voir components/DayTabs.js).
  expect(buttons[0]).toHaveStyle({ background: "#39B577" });
  expect(buttons[1]).not.toHaveStyle({ background: "#39B577" });
});

test("par défaut, affiche tous les matchs d'aujourd'hui, toutes compétitions confondues, live en premier puis par heure croissante", async () => {
  mockFetchWith(fixture());
  render(<UpcomingMatches />);

  const list = await waitFor(() => {
    const el = screen.getByTestId("match-list");
    expect(within(el).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(3);
    return el;
  });

  // Les 3 matchs d'aujourd'hui (Flamengo en direct, Chelsea à 2h, Liverpool à 6h),
  // aucun des matchs de demain/après-demain.
  const cards = within(list).getAllByRole("button", { name: /^analyser$/i }).map((btn) => btn.closest("div").textContent);
  expect(cards[0]).toContain("Flamengo"); // en direct : en premier
  expect(cards[1]).toContain("Chelsea FC"); // 2h : avant Liverpool
  expect(cards[2]).toContain("Liverpool FC"); // 6h
  expect(within(list).queryByText("Bayern Munich")).not.toBeInTheDocument();
  expect(within(list).queryByText("France")).not.toBeInTheDocument();

  // Aucun filtre par compétition sur cette page.
  expect(screen.queryByTestId("competition-filter")).not.toBeInTheDocument();
  expect(screen.queryByTestId("matchday-filter")).not.toBeInTheDocument();
});

test("cliquer sur \"Demain\" affiche uniquement le match de demain, plus aucun match d'aujourd'hui", async () => {
  mockFetchWith(fixture());
  render(<UpcomingMatches />);
  await screen.findByTestId("match-list");

  const tabs = screen.getByTestId("day-tabs");
  fireEvent.click(within(tabs).getByText("Demain"));

  const list = await waitFor(() => {
    const el = screen.getByTestId("match-list");
    expect(within(el).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1);
    return el;
  });
  expect(within(list).getByText("Bayern Munich")).toBeInTheDocument();
  expect(within(list).queryByText("Flamengo")).not.toBeInTheDocument();
  expect(within(list).queryByText("Liverpool FC")).not.toBeInTheDocument();
  expect(screen.getByTestId("day-heading")).toHaveTextContent("Demain");
});

test("le jour cliqué devient le bouton actif, l'ancien redevient inactif", async () => {
  mockFetchWith(fixture());
  render(<UpcomingMatches />);
  await screen.findByTestId("match-list");

  const tabs = screen.getByTestId("day-tabs");
  const buttons = within(tabs).getAllByRole("button");
  fireEvent.click(buttons[1]); // "Demain"

  await waitFor(() => expect(buttons[1]).toHaveStyle({ background: "#39B577" }));
  expect(buttons[0]).not.toHaveStyle({ background: "#39B577" });
});

test("un jour sans aucun match affiche \"Aucun match ce jour\", jamais une section vide ou une erreur", async () => {
  mockFetchWith(fixture());
  render(<UpcomingMatches />);
  await screen.findByTestId("match-list");

  const tabs = screen.getByTestId("day-tabs");
  const buttons = within(tabs).getAllByRole("button");
  fireEvent.click(buttons[3]); // un jour à +3 jours, sans aucun match dans la fixture

  await waitFor(() => expect(screen.getByText("Aucun match ce jour")).toBeInTheDocument());
  expect(within(screen.getByTestId("match-list")).queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
});

test("le bouton ANALYSER est visible directement sur chaque carte, sans navigation intermédiaire", async () => {
  mockFetchWith(fixture());
  render(<UpcomingMatches />);

  const list = await waitFor(() => {
    const el = screen.getByTestId("match-list");
    expect(within(el).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(3);
    return el;
  });
  expect(within(list).getByText("Flamengo")).toBeInTheDocument();
});

test("aucune donnée inventée : seuls les matchs réellement renvoyés par l'API apparaissent, avec le bon jour", async () => {
  const data = fixture();
  mockFetchWith(data);
  render(<UpcomingMatches />);

  const todayKey = localDayKey(new Date());
  const allReturnedIds = data.competitions.flatMap((c) => c.matches.map((m) => m.id));
  const todayIds = data.competitions
    .flatMap((c) => c.matches)
    .filter((m) => localDayKey(m.utcDate) === todayKey)
    .map((m) => m.id);

  const list = await waitFor(() => {
    const el = screen.getByTestId("match-list");
    expect(within(el).getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0);
    return el;
  });
  expect(within(list).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(todayIds.length);
  expect(todayIds.length).toBeLessThan(allReturnedIds.length); // vérifie que le fixture couvre bien plusieurs jours
});
