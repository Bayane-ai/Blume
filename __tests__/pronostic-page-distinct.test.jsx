/**
 * @jest-environment jsdom
 *
 * PROMPT 5 : vérification "manuelle" (rendu réel de la page) que 3 matchs ouverts
 * l'un après l'autre affichent bien 3 jeux de chiffres différents — pas seulement au
 * niveau du calcul (voir pronostic-anti-duplication.test.js), mais tels qu'affichés
 * à l'écran (probabilités, buts, scores exacts).
 */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";
import { computePronostic } from "../lib/pronostic";

let mockRouter = { isReady: true, query: {}, replace: jest.fn() };
jest.mock("next/router", () => ({
  useRouter: () => mockRouter,
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

// Trois profils d'équipes réels et distincts (mêmes que pronostic-anti-duplication.test.js).
const MATCHES = [
  {
    id: "101", homeTeamName: "Arsenal FC", awayTeamName: "Fulham FC",
    homeRow: { position: 2, points: 60, form: "WWWDW", playedGames: 22, goalsFor: 55, goalsAgainst: 15, team: { id: 10 } },
    awayRow: { position: 18, points: 20, form: "LLDLL", playedGames: 22, goalsFor: 18, goalsAgainst: 50, team: { id: 11 } },
  },
  {
    id: "102", homeTeamName: "Real Madrid", awayTeamName: "Barcelona",
    homeRow: { position: 1, points: 68, form: "WWWWW", playedGames: 24, goalsFor: 62, goalsAgainst: 18, team: { id: 20 } },
    awayRow: { position: 2, points: 64, form: "WWDWW", playedGames: 24, goalsFor: 58, goalsAgainst: 20, team: { id: 21 } },
  },
  {
    id: "103", homeTeamName: "Juventus FC", awayTeamName: "Salernitana",
    homeRow: { position: 5, points: 38, form: "DDDLD", playedGames: 22, goalsFor: 20, goalsAgainst: 18, team: { id: 30 } },
    awayRow: { position: 15, points: 22, form: "LDLLD", playedGames: 22, goalsFor: 16, goalsAgainst: 30, team: { id: 31 } },
  },
];

async function openMatch(m) {
  cleanup();
  mockRouter = {
    isReady: true,
    replace: jest.fn(),
    query: {
      id: m.id, competitionCode: "X", homeTeamId: String(m.homeRow.team.id), awayTeamId: String(m.awayRow.team.id),
      homeTeamName: m.homeTeamName, awayTeamName: m.awayTeamName,
    },
  };
  // Le mock réseau appelle le VRAI moteur de calcul (lib/pronostic.js) avec les vraies
  // statistiques de CE match — comme le ferait pages/api/analyze.js en production,
  // sans dépendre d'un accès réseau réel à football-data.org (indisponible ici).
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve(
          computePronostic({
            homeRow: m.homeRow, awayRow: m.awayRow,
            homeTeamName: m.homeTeamName, awayTeamName: m.awayTeamName,
          })
        ),
    })
  );

  render(<MatchPage />);
  await waitFor(() => expect(screen.getByTestId("prob-home")).toBeInTheDocument());

  return {
    home: screen.getByTestId("prob-home").textContent,
    draw: screen.getByTestId("prob-draw").textContent,
    away: screen.getByTestId("prob-away").textContent,
    goals: screen.getByTestId("stat-goals").textContent,
    scores: screen.getAllByTestId("correct-scores")[0].textContent,
  };
}

test("ouvrir les pronostics de 3 matchs différents affiche 3 jeux de chiffres différents à l'écran", async () => {
  const results = [];
  for (const m of MATCHES) {
    results.push(await openMatch(m));
  }

  const [r1, r2, r3] = results;

  // Chacun a bien ses propres pourcentages de victoire.
  expect(r1.home).not.toBe(r2.home);
  expect(r1.home).not.toBe(r3.home);
  expect(r2.home).not.toBe(r3.home);

  // Et sa propre estimation de buts / ses propres scores exacts.
  const fingerprints = results.map((r) => `${r.home}|${r.draw}|${r.away}|${r.goals}|${r.scores}`);
  expect(new Set(fingerprints).size).toBe(3);
});
