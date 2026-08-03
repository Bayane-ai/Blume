/**
 * @jest-environment jsdom
 *
 * components/TennisMatchOutcomeRecap.js — "Un clic sur un match terminé montre si ses
 * pronostics ont été validés" — bilan global basé UNIQUEMENT sur la probabilité de
 * victoire + chaque ligne (winner, totalGames, totalSets) individuellement — Live
 * Tennis API (plan gratuit) ne fournit plus les métriques riches de l'ancienne
 * intégration (aces, breaks, tie-break...).
 */
import { render, screen } from "@testing-library/react";
import TennisMatchOutcomeRecap from "../components/TennisMatchOutcomeRecap";

function basePronostic(overrides = {}) {
  return {
    home: { name: "Djokovic" }, away: { name: "Alcaraz" },
    historyStatus: "success",
    gameTotals: { line: 22.5, side: "Plus", lines: [{ line: 22.5, side: "Plus" }] },
    totalSets: { line: 2.5, side: "Moins" },
    verification: { winner: true, totalGames: false, totalSets: true },
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

test("vainqueur et total de jeux apparaissent chacun comme leur propre ligne", () => {
  render(<TennisMatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByTestId("tennis-verified-winner").querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
});

test("total de sets vérifié individuellement", () => {
  render(<TennisMatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByText(/Total sets/)).toBeInTheDocument();
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
