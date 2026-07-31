/**
 * @jest-environment jsdom
 *
 * components/BasketballPronosticHistoryCard.js — une carte par match basket terminé
 * et vérifié : équipes, score final, date, probabilité de victoire (pas de nul),
 * badge Succès/Échec, et chaque ligne vérifiée individuellement (réutilise
 * components/BasketballVerifiedLines.js, déjà testé en détail via
 * basketball-match-outcome-recap.test.jsx).
 */
import { render, screen } from "@testing-library/react";
import BasketballPronosticHistoryCard from "../components/BasketballPronosticHistoryCard";

function baseItem(overrides = {}) {
  return {
    match_id: "bk-101",
    home_team_name: "Lakers",
    away_team_name: "Warriors",
    match_date: "2026-01-15T20:00:00Z",
    final_score: { home: 114, away: 107 },
    status: "success",
    prediction: {
      probabilities: { home: 63, away: 37 },
      correctScores: ["114-107"],
      markets: { totalPoints: { available: true, line: 220.5, side: "Plus", lines: [{ line: 220.5, side: "Plus" }] }, totalHome: {}, totalAway: {} },
      periods: {},
      pointSpread: { safe: { line: 4.5, side: "Moins" }, risky: { line: 10.5, side: "Plus" } },
      rebounds: {}, assists: {}, threePointers: {}, fouls: {},
      turnovers: { total: {} }, freeThrows: { total: {} },
      verification: { winner: true, correctScores: true, totalPoints: true },
    },
    ...overrides,
  };
}

test("rien si aucun item", () => {
  const { container } = render(<BasketballPronosticHistoryCard item={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("affiche les équipes, le score final, le badge Succès et la probabilité de victoire", () => {
  render(<BasketballPronosticHistoryCard item={baseItem()} />);
  expect(screen.getByText("Lakers — Warriors")).toBeInTheDocument();
  expect(screen.getByTestId("basket-history-final-score")).toHaveTextContent("114 - 107");
  expect(screen.getByTestId("basket-history-badge")).toHaveTextContent("Succès");
  expect(screen.getByText(/Victoire Lakers : 63 %/)).toBeInTheDocument();
});

test("badge Échec quand status='failure'", () => {
  render(<BasketballPronosticHistoryCard item={baseItem({ status: "failure" })} />);
  expect(screen.getByTestId("basket-history-badge")).toHaveTextContent("Échec");
});

test("affiche les lignes vérifiées ligne par ligne", () => {
  render(<BasketballPronosticHistoryCard item={baseItem()} />);
  expect(screen.getByTestId("basket-verified-lines")).toBeInTheDocument();
  expect(screen.getByTestId("basket-verified-winner").querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
});

test("score indisponible : message honnête plutôt qu'un score erroné", () => {
  render(<BasketballPronosticHistoryCard item={baseItem({ final_score: null })} />);
  expect(screen.getByTestId("basket-history-final-score")).toHaveTextContent("Score indisponible");
});
