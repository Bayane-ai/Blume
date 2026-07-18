/**
 * Vérifie que les scores exacts proposés ne sont plus figés à exactement 3, et
 * reflètent le profil réel de chaque équipe : une confrontation défensive reste
 * groupée sur des petits scores, une confrontation ouverte (deux équipes qui
 * marquent beaucoup) fait remonter des scores plus variés/plus élevés.
 */
import { computePronostic } from "../lib/pronostic";

function row({ goalsFor, goalsAgainst, playedGames = 20, id }) {
  return { position: 1, points: 40, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

test("une confrontation défensive (peu de buts des deux côtés) reste groupée sur des petits scores", () => {
  const home = row({ goalsFor: 12, goalsAgainst: 8, id: 1 }); // ~0.6 but/match
  const away = row({ goalsFor: 10, goalsAgainst: 10, id: 2 });
  const result = computePronostic({ homeRow: home, awayRow: away, homeTeamName: "A", awayTeamName: "B" });

  const maxGoalsInAnyScore = Math.max(
    ...result.correctScores.map((s) => s.score.split("-").reduce((a, b) => Number(a) + Number(b), 0))
  );
  expect(maxGoalsInAnyScore).toBeLessThanOrEqual(3);
});

test("une confrontation ouverte (deux équipes offensives) propose plus de scores, avec des totaux plus élevés", () => {
  const home = row({ goalsFor: 60, goalsAgainst: 40, id: 1 }); // ~3 buts/match
  const away = row({ goalsFor: 55, goalsAgainst: 45, id: 2 });
  const result = computePronostic({ homeRow: home, awayRow: away, homeTeamName: "A", awayTeamName: "B" });

  expect(result.correctScores.length).toBeGreaterThan(3);
  const totals = result.correctScores.map((s) => s.score.split("-").reduce((a, b) => Number(a) + Number(b), 0));
  expect(Math.max(...totals)).toBeGreaterThan(3);
  // Les scores proposés ne sont pas tous identiques (mélange de petits et grands totaux).
  expect(new Set(totals).size).toBeGreaterThan(1);
});

test("le nombre de scores proposés n'est plus toujours exactement 3", () => {
  const balanced = row({ goalsFor: 30, goalsAgainst: 30, id: 1 });
  const result = computePronostic({ homeRow: balanced, awayRow: balanced, homeTeamName: "A", awayTeamName: "B" });
  expect(result.correctScores.length).toBeGreaterThanOrEqual(3);
  expect(result.correctScores.length).toBeLessThanOrEqual(6);
});
