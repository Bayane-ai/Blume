/**
 * @jest-environment jsdom
 *
 * components/BasketballMatchOutcomeRecap.js — bloc 4, PROMPT point 4 : "En cliquant
 * sur un match terminé, on voit si ses pronostics ont été validés ou non" — bilan
 * global (majorité des lignes) + chaque ligne individuellement (crochet vert/croix
 * rouge/"Indisponible"), métriques basket (pas de corners/cartons).
 */
import { render, screen } from "@testing-library/react";
import BasketballMatchOutcomeRecap from "../components/BasketballMatchOutcomeRecap";

function market(line, side) {
  return { available: true, line, side, lines: [{ line, side }] };
}
function statBlock(total, home, away) {
  return { total: market(total, "Plus"), home: market(home, "Plus"), away: market(away, "Plus") };
}

function basePronostic(overrides = {}) {
  return {
    historyStatus: "success",
    markets: { totalPoints: market(220.5, "Plus"), totalHome: market(112.5, "Plus"), totalAway: market(105.5, "Moins") },
    periods: { quarter1: market(52.5, "Plus"), firstHalf: market(104.5, "Plus"), secondHalf: market(103.5, "Moins") },
    pointSpread: { favorite: "home", safe: { line: 4.5, side: "Moins" }, risky: { line: 10.5, side: "Plus" } },
    rebounds: statBlock(84.5, 43.5, 40.5),
    assists: statBlock(45.5, 24.5, 21.5),
    threePointers: statBlock(22.5, 12.5, 10.5),
    fouls: statBlock(37.5, 18.5, 19.5),
    turnovers: { total: market(24.5, "Moins") },
    freeThrows: { total: market(31.5, "Plus") },
    correctScores: ["114-107", "108-101"],
    verification: {
      winner: true, correctScores: false,
      totalPoints: true, totalHome: false, totalAway: true,
      quarter1: null, firstHalf: true, secondHalf: false,
      pointSpread: { safe: true, risky: false },
      rebounds: { total: true, home: false, away: true },
      assists: { total: null, home: null, away: null },
      threePointers: { total: false, home: false, away: true },
      fouls: { total: true, home: true, away: false },
      turnovers: { total: true },
      freeThrows: { total: false },
    },
    ...overrides,
  };
}

test("affiche \"Succès\" avec un crochet vert quand la majorité des lignes est validée", () => {
  render(<BasketballMatchOutcomeRecap pronostic={basePronostic({ historyStatus: "success" })} />);
  const row = screen.getByTestId("basket-recap-global");
  expect(row).toHaveTextContent(/Bilan global du match.*Succès/);
  expect(row.querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
});

test("affiche \"Échec\" avec une croix rouge quand la majorité des lignes est ratée", () => {
  render(<BasketballMatchOutcomeRecap pronostic={basePronostic({ historyStatus: "failure" })} />);
  const row = screen.getByTestId("basket-recap-global");
  expect(row).toHaveTextContent(/Bilan global du match.*Échec/);
  expect(row.querySelector('[data-testid="line-icon-failure"]')).toBeInTheDocument();
});

test("probabilité de victoire et scores finaux apparaissent chacun comme leur propre ligne", () => {
  render(<BasketballMatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByTestId("basket-verified-winner").querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
  expect(screen.getByTestId("basket-verified-correct-scores").querySelector('[data-testid="line-icon-failure"]')).toBeInTheDocument();
});

test("ligne indisponible (aucune vraie donnée) : jamais un crochet/une croix inventés", () => {
  render(<BasketballMatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByText(/^1er quart-temps :/).closest('[data-testid="verified-line"]').querySelector('[data-testid="line-icon-unavailable"]')).toBeInTheDocument();
});

test("affiche les blocs rebonds/passes/3 points/fautes (Total + Total 1 + Total 2)", () => {
  render(<BasketballMatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByTestId("basket-verified-group-Rebonds")).toBeInTheDocument();
  expect(screen.getByTestId("basket-verified-group-Passes décisives")).toBeInTheDocument();
  expect(screen.getByTestId("basket-verified-group-Tirs à 3 points")).toBeInTheDocument();
  expect(screen.getByTestId("basket-verified-group-Fautes")).toBeInTheDocument();
});

test("ballons perdus/lancers francs : une seule ligne chacun (Total match), jamais Total 1/Total 2", () => {
  render(<BasketballMatchOutcomeRecap pronostic={basePronostic()} />);
  expect(screen.getByText(/^Ballons perdus :/)).toBeInTheDocument();
  expect(screen.getByText(/^Lancers francs réussis :/)).toBeInTheDocument();
});

test("sans historyStatus (match pas encore classé) : pas de ligne de bilan global, le reste s'affiche quand même", () => {
  render(<BasketballMatchOutcomeRecap pronostic={basePronostic({ historyStatus: undefined })} />);
  expect(screen.queryByTestId("basket-recap-global")).not.toBeInTheDocument();
  expect(screen.getByTestId("basket-verified-lines")).toBeInTheDocument();
});

test("ne s'affiche pas sans données de vérification", () => {
  const { container } = render(<BasketballMatchOutcomeRecap pronostic={{ historyStatus: "success" }} />);
  expect(container).toBeEmptyDOMElement();
});

test("ne s'affiche pas sans pronostic du tout", () => {
  const { container } = render(<BasketballMatchOutcomeRecap pronostic={null} />);
  expect(container).toBeEmptyDOMElement();
});
