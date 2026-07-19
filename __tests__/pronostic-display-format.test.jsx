/**
 * @jest-environment jsdom
 *
 * Règle d'affichage demandée : seules les probabilités de victoire (domicile/nul/
 * extérieur) sont montrées en pourcentage. Tout le reste (buts, corners, tirs,
 * cartons, possession, tendances +2.5 buts/les 2 marquent, scores exacts) doit être
 * un intervalle ou une estimation — jamais un "%".
 */
import { render, screen, within } from "@testing-library/react";
import PronosticResults from "../components/PronosticResults";
import { computePronostic } from "../lib/pronostic";

function rowFor({ goalsFor, goalsAgainst, playedGames = 20, id, position = 5, points = 30 }) {
  return { position, points, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

test('seules les probabilités de victoire affichent un "%" — buts/corners/tirs/cartons/possession/tendances/scores sont des intervalles ou estimations', () => {
  const pronostic = computePronostic({
    homeRow: rowFor({ goalsFor: 45, goalsAgainst: 20, id: 1 }),
    awayRow: rowFor({ goalsFor: 30, goalsAgainst: 28, id: 2 }),
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
  });

  const { container } = render(<PronosticResults pronostic={pronostic} loading={false} />);

  expect(screen.getByTestId("prob-home").textContent).toMatch(/^\d+(\.\d+)?%$/);
  expect(screen.getByTestId("prob-draw").textContent).toMatch(/^\d+(\.\d+)?%$/);
  expect(screen.getByTestId("prob-away").textContent).toMatch(/^\d+(\.\d+)?%$/);

  expect(screen.getByTestId("stat-goals").textContent).toMatch(/^entre \d+ et \d+$/);
  expect(screen.getByTestId("stat-corners").textContent).toMatch(/^environ \d+-\d+$/);
  expect(screen.getByTestId("stat-shots").textContent).toMatch(/^environ \d+-\d+$/);
  expect(screen.getByTestId("stat-cards").textContent).toMatch(/^environ \d+-\d+$/);
  expect(screen.getByTestId("stat-possession").textContent).toMatch(/^\d+ - \d+$/);
  expect(screen.getByTestId("stat-over25").textContent).toMatch(/^\d+\.\d\/10$/);
  expect(screen.getByTestId("stat-btts").textContent).toMatch(/^\d+\.\d\/10$/);

  const scoresBlock = screen.getByTestId("correct-scores");
  expect(within(scoresBlock).getAllByText(/^Le plus probable$|^Possible$/).length).toBeGreaterThanOrEqual(3);
  expect(scoresBlock.textContent).not.toMatch(/%/);

  // Aucun "%" nulle part sur la page hors des 3 valeurs de victoire et du titre de
  // cette section ("% de victoire", qui nomme légitimement la seule partie en %).
  const percentCount = (container.textContent.match(/%/g) || []).length;
  expect(percentCount).toBe(4);
});

test("chaque équipe a ses propres statistiques affichées séparément — jamais mélangées ni copiées d'une équipe à l'autre", () => {
  // Deux profils délibérément opposés : l'équipe à domicile très offensive, celle à
  // l'extérieur très défensive — si les stats étaient mélangées/copiées, les deux
  // colonnes se ressembleraient malgré ces profils opposés.
  const pronostic = computePronostic({
    homeRow: rowFor({ goalsFor: 65, goalsAgainst: 15, id: 1 }),
    awayRow: rowFor({ goalsFor: 15, goalsAgainst: 55, id: 2 }),
    homeTeamName: "Attaque FC", awayTeamName: "Defense FC",
  });

  render(<PronosticResults pronostic={pronostic} loading={false} />);

  const teamStats = screen.getByTestId("team-stats");
  expect(within(teamStats).getByText("Attaque FC")).toBeInTheDocument();
  expect(within(teamStats).getByText("Defense FC")).toBeInTheDocument();

  const homeGoals = Number(screen.getByTestId("team-goals-home").textContent);
  const awayGoals = Number(screen.getByTestId("team-goals-away").textContent);
  expect(homeGoals).toBeGreaterThan(awayGoals);
  expect(homeGoals).toBe(pronostic.goals.expectedHome);
  expect(awayGoals).toBe(pronostic.goals.expectedAway);

  const homeCorners = Number(screen.getByTestId("team-corners-home").textContent);
  const awayCorners = Number(screen.getByTestId("team-corners-away").textContent);
  expect(homeCorners).toBe(pronostic.extraStats.corners.home);
  expect(awayCorners).toBe(pronostic.extraStats.corners.away);
  expect(homeCorners).not.toBe(awayCorners);

  const homeShots = Number(screen.getByTestId("team-shots-home").textContent);
  const awayShots = Number(screen.getByTestId("team-shots-away").textContent);
  expect(homeShots).toBeGreaterThan(awayShots);
});

test("l'ordre des scores exacts va bien du plus probable au moins probable, sans pourcentage affiché", () => {
  const pronostic = computePronostic({
    homeRow: rowFor({ goalsFor: 60, goalsAgainst: 15, id: 1 }),
    awayRow: rowFor({ goalsFor: 20, goalsAgainst: 45, id: 2 }),
    homeTeamName: "Real Madrid", awayTeamName: "Getafe CF",
  });

  render(<PronosticResults pronostic={pronostic} loading={false} />);
  const scoresBlock = screen.getByTestId("correct-scores");
  const labels = within(scoresBlock).getAllByText(/^Le plus probable$|^Possible$/).map((el) => el.textContent);

  expect(labels[0]).toBe("Le plus probable");
  expect(labels.slice(1).every((l) => l === "Possible")).toBe(true);
});
