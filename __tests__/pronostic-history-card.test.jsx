/**
 * @jest-environment jsdom
 *
 * components/PronosticHistoryCard.js — une carte par match terminé et vérifié :
 * équipes, score final, date, pronostics donnés (1X2 + Total de buts), badge visible
 * Succès (vert) / Échec (rouge).
 */
import { render, screen } from "@testing-library/react";
import PronosticHistoryCard from "../components/PronosticHistoryCard";

function baseItem(overrides = {}) {
  return {
    match_id: "101",
    home_team_name: "Arsenal FC",
    away_team_name: "Chelsea FC",
    match_date: "2026-01-15T15:00:00Z",
    final_score: { home: 2, away: 1 },
    status: "success",
    prediction: {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: { totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] } },
    },
    ...overrides,
  };
}

test("affiche les deux équipes, le score final et la date", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  expect(screen.getByText("Arsenal FC — Chelsea FC")).toBeInTheDocument();
  expect(screen.getByTestId("history-final-score")).toHaveTextContent("2 - 1");
  expect(screen.getByText("15/01/2026")).toBeInTheDocument();
});

test("affiche un badge \"Succès\" pour un match classé succès", () => {
  render(<PronosticHistoryCard item={baseItem({ status: "success" })} />);
  expect(screen.getByTestId("history-badge")).toHaveTextContent("Succès");
});

test("affiche un badge \"Échec\" pour un match classé échec", () => {
  render(<PronosticHistoryCard item={baseItem({ status: "failure" })} />);
  expect(screen.getByTestId("history-badge")).toHaveTextContent("Échec");
});

test("affiche les pronostics qui avaient été donnés : probabilités 1X2 et Total de buts", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  expect(screen.getByText(/Victoire Arsenal FC : 60 %/)).toBeInTheDocument();
  expect(screen.getByText(/Total pronostiqué : Plus de 2,5/)).toBeInTheDocument();
});

test("aucune cote affichée (jamais un nombre décimal type 1.85)", () => {
  const { container } = render(<PronosticHistoryCard item={baseItem()} />);
  expect(container.textContent).not.toMatch(/\b\d\.\d{2}\b/);
});

test("score indisponible affiché honnêtement plutôt qu'un score inventé", () => {
  render(<PronosticHistoryCard item={baseItem({ final_score: null })} />);
  expect(screen.getByTestId("history-final-score")).toHaveTextContent("Score indisponible");
});

test("ne s'affiche pas (pas de carte vide/cassée) sans item", () => {
  const { container } = render(<PronosticHistoryCard item={null} />);
  expect(container).toBeEmptyDOMElement();
});
