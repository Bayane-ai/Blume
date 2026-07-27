/**
 * @jest-environment jsdom
 *
 * pages/a-venir.js — "Tous les matchs programmés, groupés jour par jour par date,
 * toutes compétitions confondues" (voir PROMPT). Vérifie le regroupement visuel par
 * jour (en-têtes "Aujourd'hui"/"Demain"/date complète) et l'affichage d'un message
 * d'erreur explicite (au lieu d'une liste vide silencieuse) quand l'API échoue.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import UpcomingMatches from "../pages/a-venir";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/a-venir", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
}));

const basePronostic = {
  available: true, home: {}, away: {},
  probabilities: { home: 40, draw: 30, away: 30 },
  goals: { expectedHome: 1, expectedAway: 1, expectedTotal: 2, over25: 40, bttsYes: 40 },
};

// +2h de marge avant toute chose (jamais un match "aujourd'hui" déjà passé selon
// l'heure à laquelle la suite de tests tourne réellement), puis +24h par jour
// souhaité — ajouter 24h à une heure locale tombe TOUJOURS sur le jour calendaire
// local suivant, quelle que soit l'heure de départ, donc "aujourd'hui"/"demain"
// restent des jours distincts sans dépendre de l'heure d'exécution des tests.
function upcomingMatch({ id, compCode, compName, home, away, daysFromNow }) {
  const d = new Date(Date.now() + 2 * 3600000 + daysFromNow * 24 * 3600000);
  return {
    id, status: "SCHEDULED", utcDate: d.toISOString(),
    competition: { code: compCode, name: compName, emblem: "" },
    homeTeam: { id: id * 10, name: home, crest: "" },
    awayTeam: { id: id * 10 + 1, name: away, crest: "" },
    score: { fullTime: { home: null, away: null } },
    pronostic: basePronostic,
  };
}

test('regroupe les matchs par jour local : "Aujourd\'hui" et "Demain" apparaissent comme en-têtes, chacun avec ses propres matchs, toutes compétitions confondues', async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            competitions: [
              {
                code: "PL", name: "Premier League", area: "",
                matches: [upcomingMatch({ id: 1, compCode: "PL", compName: "Premier League", home: "Arsenal FC", away: "Chelsea FC", daysFromNow: 0 })],
              },
              {
                code: "FL1", name: "Ligue 1", area: "",
                matches: [upcomingMatch({ id: 2, compCode: "FL1", compName: "Ligue 1", home: "PSG", away: "Marseille", daysFromNow: 1 })],
              },
            ],
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<UpcomingMatches />);

  const groups = await screen.findAllByTestId("day-group");
  expect(groups.length).toBeGreaterThanOrEqual(2);

  const headings = groups.map((g) => within(g).getByRole("heading").textContent);
  expect(headings).toContain("Aujourd'hui");
  expect(headings).toContain("Demain");

  const todayGroup = groups.find((g) => within(g).getByRole("heading").textContent === "Aujourd'hui");
  expect(within(todayGroup).getByText("Arsenal FC")).toBeInTheDocument();
  expect(within(todayGroup).queryByText("PSG")).not.toBeInTheDocument();

  const tomorrowGroup = groups.find((g) => within(g).getByRole("heading").textContent === "Demain");
  expect(within(tomorrowGroup).getByText("PSG")).toBeInTheDocument();
});

test("une erreur de l'API (ex : quota dépassé) affiche le message technique explicite, jamais une liste vide silencieuse", async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ error: "Quota de requêtes football-data.org dépassé (code 429) — réessaie dans une minute." }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<UpcomingMatches />);

  expect(await screen.findByTestId("week-error")).toHaveTextContent(/quota de requêtes football-data\.org dépassé/i);
  expect(screen.queryByTestId("day-group")).not.toBeInTheDocument();
});

test("une panne réseau affiche un message explicite distinct (pas juste 'aucun match')", async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/matches")) {
      return Promise.reject(new Error("network down"));
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<UpcomingMatches />);

  expect(await screen.findByTestId("week-error")).toHaveTextContent(/impossible de contacter le serveur/i);
});
