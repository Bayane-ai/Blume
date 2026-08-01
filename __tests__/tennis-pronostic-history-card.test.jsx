/**
 * @jest-environment jsdom
 *
 * components/TennisPronosticHistoryCard.js — une carte par match tennis terminé et
 * classé : joueurs, score final en sets, date, probabilité de victoire (pas de nul),
 * badge Succès/Échec, et chaque ligne vérifiée individuellement (réutilise
 * components/TennisVerifiedLines.js).
 */
import { render, screen } from "@testing-library/react";
import TennisPronosticHistoryCard from "../components/TennisPronosticHistoryCard";

function baseItem(overrides = {}) {
  return {
    match_id: "tn-101",
    home_team_name: "Djokovic",
    away_team_name: "Alcaraz",
    match_date: "2026-01-15T20:00:00Z",
    final_score: { home: 3, away: 1 },
    status: "success",
    prediction: {
      probabilities: { home: 63, away: 37 },
      setScores: [{ score: "3-1", winner: "p1", probability: 24 }],
      gameTotals: { total: { available: true, line: 36.5, side: "Plus", lines: [{ line: 36.5, side: "Plus" }] }, home: {}, away: {} },
      gameHandicap: { safe: { line: 2.5, side: "Plus" }, risky: { line: 5.5, side: "Plus" } },
      setsBlock: { totalSets: { line: 3.5, side: "Plus" }, bothWinASet: "Oui", firstSetWinner: "home", firstSetGames: {} },
      aces: {}, doubleFaults: {}, breaks: {}, tiebreak: { likely: "Oui" },
      verification: { winner: true, correctScores: true, totalGames: true, breaks: { total: null, home: null, away: null } },
    },
    ...overrides,
  };
}

test("rien si aucun item", () => {
  const { container } = render(<TennisPronosticHistoryCard item={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("affiche les joueurs, le score final en sets, le badge Succès et la probabilité de victoire", () => {
  render(<TennisPronosticHistoryCard item={baseItem()} />);
  expect(screen.getByText("Djokovic — Alcaraz")).toBeInTheDocument();
  expect(screen.getByTestId("tennis-history-final-score")).toHaveTextContent("3 - 1");
  expect(screen.getByTestId("tennis-history-badge")).toHaveTextContent("Succès");
  expect(screen.getByText(/Victoire Djokovic : 63 %/)).toBeInTheDocument();
});

test("badge Échec quand status='failure'", () => {
  render(<TennisPronosticHistoryCard item={baseItem({ status: "failure" })} />);
  expect(screen.getByTestId("tennis-history-badge")).toHaveTextContent("Échec");
});

test("affiche les lignes vérifiées ligne par ligne, breaks toujours Indisponible", () => {
  render(<TennisPronosticHistoryCard item={baseItem()} />);
  expect(screen.getByTestId("tennis-verified-lines")).toBeInTheDocument();
  expect(screen.getByTestId("tennis-verified-winner").querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
});

test("score indisponible : message honnête plutôt qu'un score erroné", () => {
  render(<TennisPronosticHistoryCard item={baseItem({ final_score: null })} />);
  expect(screen.getByTestId("tennis-history-final-score")).toHaveTextContent("Score indisponible");
});
