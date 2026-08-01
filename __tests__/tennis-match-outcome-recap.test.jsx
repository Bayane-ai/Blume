/**
 * @jest-environment jsdom
 *
 * components/TennisMatchOutcomeRecap.js — bloc 8, PROMPT point 4 : "Un clic sur un
 * match terminé montre si ses pronostics ont été validés" — bilan global basé
 * UNIQUEMENT sur la probabilité de victoire (règle explicite du bloc 8) + chaque
 * ligne individuellement (crochet vert/croix rouge/"Indisponible"), métriques tennis.
 */
import { render, screen } from "@testing-library/react";
import TennisMatchOutcomeRecap from "../components/TennisMatchOutcomeRecap";

function market(line, side) {
  return { available: true, line, side, lines: [{ line, side }] };
}
function statBlock(total, home, away) {
  return { total: market(total, "Plus"), home: market(home, "Plus"), away: market(away, "Plus") };
}

function basePronostic(overrides = {}) {
  return {
    home: { name: "Djokovic" }, away: { name: "Alcaraz" },
    historyStatus: "success",
    setScores: [{ score: "3-1", winner: "p1", probability: 24 }, { score: "3-0", winner: "p1", probability: 22 }],
    gameTotals: { total: market(36.5, "Plus"), home: market(20.5, "Plus"), away: market(15.5, "Moins") },
    gameHandicap: { favorite: "home", safe: { line: 2.5, side: "Plus" }, risky: { line: 5.5, side: "Plus" } },
    setsBlock: { totalSets: { line: 3.5, side: "Plus" }, bothWinASet: "Oui", firstSetWinner: "home", firstSetGames: market(9.5, "Moins") },
    aces: statBlock(16.5, 10.5, 5.5),
    doubleFaults: statBlock(4.5, 1.5, 3.5),
    breaks: statBlock(4.5, 2.5, 1.5),
    tiebreak: { likely: "Oui" },
    verification: {
      winner: true, correctScores: false,
      totalGames: true, totalGamesHome: false, totalGamesAway: true,
      gameHandicap: { safe: true, risky: false },
      totalSets: true, bothWinASet: null, firstSetWinner: true, firstSetGames: false,
      aces: { total: true, home: false, away: true },
      doubleFaults: { total: false, home: false, away: true },
      breaks: { total: null, home: null, away: null },
      tiebreak: true,
    },
    ...overrides,
  };
}

test("affiche \"Succès\" avec un crochet vert basé sur la probabilité de victoire", () => {
  render(<TennisMatchOutcomeRecap pronostic={basePronostic({ historyStatus: "success" })} />);
  const row = screen.getByTestId("tennis-recap-global");
  expect(row).toHaveTextContent(/Bilan global du match.*Succès/);
  expect(row.querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
});

test("affiche \"Échec\" avec une croix rouge", () => {
  render(<TennisMatchOutcomeRecap pronostic={basePronostic({ historyStatus: "failure" })} />);
  const row = screen.getByTestId("tennis-recap-global");
  expect(row).toHaveTextContent(/Bilan global du match.*Échec/);
  expect(row.querySelector('[data-testid="line-icon-failure"]')).toBeInTheDocument();
});

test("probabilité de victoire et scores en sets apparaissent chacun comme leur propre ligne", () => {
  render(<TennisMatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByTestId("tennis-verified-winner").querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
  expect(screen.getByTestId("tennis-verified-correct-scores").querySelector('[data-testid="line-icon-failure"]')).toBeInTheDocument();
});

test("breaks toujours \"Indisponible\" (aucune source fiable de décompte total)", () => {
  render(<TennisMatchOutcomeRecap pronostic={basePronostic()} />);
  const group = screen.getByTestId("tennis-verified-group-Breaks");
  expect(group.querySelectorAll('[data-testid="line-icon-unavailable"]').length).toBe(3);
});

test("affiche les blocs aces/doubles fautes/breaks (Total + Total 1 + Total 2)", () => {
  render(<TennisMatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByTestId("tennis-verified-group-Aces")).toBeInTheDocument();
  expect(screen.getByTestId("tennis-verified-group-Doubles fautes")).toBeInTheDocument();
});

test("sans historyStatus (match pas encore classé) : pas de ligne de bilan global, le reste s'affiche quand même", () => {
  render(<TennisMatchOutcomeRecap pronostic={basePronostic({ historyStatus: undefined })} />);
  expect(screen.queryByTestId("tennis-recap-global")).not.toBeInTheDocument();
  expect(screen.getByTestId("tennis-verified-lines")).toBeInTheDocument();
});

test("ne s'affiche pas sans données de vérification", () => {
  const { container } = render(<TennisMatchOutcomeRecap pronostic={{ historyStatus: "success" }} />);
  expect(container).toBeEmptyDOMElement();
});

test("ne s'affiche pas sans pronostic du tout", () => {
  const { container } = render(<TennisMatchOutcomeRecap pronostic={null} />);
  expect(container).toBeEmptyDOMElement();
});
