/**
 * @jest-environment jsdom
 *
 * components/MatchOutcomeRecap.js — Bloc 4 du parcours vidéo : quand on appuie sur un
 * match déjà terminé, un récapitulatif s'affiche indiquant, pronostic par pronostic,
 * s'il a été validé (crochet vert) ou raté (croix rouge) — y compris le résultat
 * Réussi/Échec de la probabilité de victoire (voir lib/pronosticHistory.js,
 * classifyOutcome : jugé sur l'équipe favorite désignée avant le match).
 */
import { render, screen } from "@testing-library/react";
import MatchOutcomeRecap from "../components/MatchOutcomeRecap";

function statBlock(total, home, away) {
  return {
    total: { line: total, side: "Plus", lines: [{ line: total, side: "Plus" }] },
    home: { line: home, side: "Plus", lines: [{ line: home, side: "Plus" }] },
    away: { line: away, side: "Plus", lines: [{ line: away, side: "Plus" }] },
    half: { label: "1ère mi-temps", market: { line: total / 2, side: "Plus", lines: [] } },
  };
}

function basePronostic(overrides = {}) {
  return {
    historyStatus: "success",
    markets: {
      totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] },
      totalHome: { line: 1.5, side: "Plus", lines: [{ line: 1.5, side: "Plus" }] },
      totalAway: { line: 0.5, side: "Moins", lines: [{ line: 0.5, side: "Moins" }] },
      shots: { line: 20.5, side: "Plus", lines: [{ line: 20.5, side: "Plus" }] },
      shotsOnTarget: { line: 6.5, side: "Plus", lines: [{ line: 6.5, side: "Plus" }] },
      yellowCards: { safe: { line: 3.5, side: "Moins" }, risky: { line: 2.5, side: "Moins" } },
      redCards: { safe: { line: 0.5, side: "Moins" }, risky: { line: 0.5, side: "Plus" } },
    },
    matchStats: {
      corners: statBlock(9.5, 5.5, 3.5),
      offsides: statBlock(3.5, 2.5, 1.5),
      fouls: statBlock(21.5, 11.5, 9.5),
      throwIns: statBlock(41.5, 21.5, 19.5),
    },
    verification: {
      totalGoals: true, totalHome: false, totalAway: true,
      corners: { total: true, home: false, away: true },
      offsides: { total: null, home: null, away: null },
      fouls: { total: false, home: false, away: true },
      throwIns: { total: null, home: null, away: null },
      shots: true, shotsOnTarget: false,
      yellowCards: { safe: true, risky: false },
      redCards: { safe: null, risky: null },
    },
    ...overrides,
  };
}

test("affiche \"Réussi\" avec un crochet vert quand l'équipe favorite a gagné", () => {
  render(<MatchOutcomeRecap pronostic={basePronostic({ historyStatus: "success" })} />);
  const row = screen.getByTestId("recap-win-probability");
  expect(row).toHaveTextContent(/Probabilité de victoire.*Réussi/);
  expect(row.querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
  expect(row.querySelector('[data-testid="line-icon-failure"]')).not.toBeInTheDocument();
});

test("affiche \"Échec\" avec une croix rouge quand l'équipe favorite n'a pas gagné", () => {
  render(<MatchOutcomeRecap pronostic={basePronostic({ historyStatus: "failure" })} />);
  const row = screen.getByTestId("recap-win-probability");
  expect(row).toHaveTextContent(/Probabilité de victoire.*Échec/);
  expect(row.querySelector('[data-testid="line-icon-failure"]')).toBeInTheDocument();
  expect(row.querySelector('[data-testid="line-icon-success"]')).not.toBeInTheDocument();
});

test("affiche aussi chaque autre ligne de pronostic individuellement, avec son propre crochet/croix", () => {
  render(<MatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByText(/^Total : Plus de 2,5$/).closest('[data-testid="verified-line"]').querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
  expect(screen.getByText(/^Total 1 : Plus de 1,5$/).closest('[data-testid="verified-line"]').querySelector('[data-testid="line-icon-failure"]')).toBeInTheDocument();
  expect(screen.getByTestId("verified-group-Corners")).toBeInTheDocument();
});

test("sans résultat de compte-rendu encore connu (match pas encore classé) : pas de ligne \"Probabilité de victoire\"", () => {
  render(<MatchOutcomeRecap pronostic={basePronostic({ historyStatus: undefined })} />);
  expect(screen.queryByTestId("recap-win-probability")).not.toBeInTheDocument();
  // Le reste du compte-rendu (les autres lignes) reste affiché.
  expect(screen.getByTestId("verified-lines")).toBeInTheDocument();
});

test("ne s'affiche pas (pas de carte vide/cassée) sans données de vérification", () => {
  const { container } = render(<MatchOutcomeRecap pronostic={{ historyStatus: "success" }} />);
  expect(container).toBeEmptyDOMElement();
});

test("ne s'affiche pas sans pronostic du tout", () => {
  const { container } = render(<MatchOutcomeRecap pronostic={null} />);
  expect(container).toBeEmptyDOMElement();
});
