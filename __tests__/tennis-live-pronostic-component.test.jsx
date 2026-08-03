/**
 * @jest-environment jsdom
 *
 * components/TennisLivePronostic.js — les 4 lignes calculables avec Live Tennis API
 * (plan gratuit) : vainqueur du match, vainqueur du set en cours, total de jeux,
 * total de sets — jamais de cote affichée.
 */
import { render, screen } from "@testing-library/react";
import TennisLivePronostic from "../components/TennisLivePronostic";

function basePronostic(overrides = {}) {
  return {
    available: true,
    home: { name: "Djokovic" }, away: { name: "Alcaraz" },
    probabilities: { home: 65.2, away: 34.8 },
    currentSetProbabilities: { home: 58.1, away: 41.9 },
    gameTotals: { line: 22.5, side: "Plus", confidence: 60, lines: [{ line: 22.5, side: "Plus", confidence: 60 }] },
    totalSets: { line: 2.5, side: "Moins" },
    note: "Estimation statistique...",
    ...overrides,
  };
}

test("affiche le vainqueur du match avec les deux pourcentages", () => {
  render(<TennisLivePronostic pronostic={basePronostic()} />);
  const card = screen.getByTestId("tennis-win-probability-card");
  expect(card).toHaveTextContent("Djokovic : 65.2 %");
  expect(card).toHaveTextContent("Alcaraz : 34.8 %");
});

test("affiche le vainqueur du set en cours", () => {
  render(<TennisLivePronostic pronostic={basePronostic()} />);
  const card = screen.getByTestId("tennis-current-set-card");
  expect(card).toHaveTextContent("58.1 %");
  expect(card).toHaveTextContent("41.9 %");
});

test("affiche le total de jeux au format Plus/Moins X,5, jamais une cote", () => {
  render(<TennisLivePronostic pronostic={basePronostic()} />);
  expect(screen.getByTestId("tennis-total-games")).toHaveTextContent("Plus de 22,5");
});

test("affiche le total de sets", () => {
  render(<TennisLivePronostic pronostic={basePronostic()} />);
  expect(screen.getByTestId("tennis-total-sets")).toHaveTextContent("Moins de 2,5");
});

test("pronostic indisponible : message honnête, jamais un écran cassé", () => {
  render(<TennisLivePronostic pronostic={{ available: false, reason: "clé manquante" }} />);
  expect(screen.getByText("clé manquante")).toBeInTheDocument();
});

test("aucun pronostic du tout : message générique", () => {
  render(<TennisLivePronostic pronostic={null} />);
  expect(screen.getByText("Pronostics indisponibles pour le moment.")).toBeInTheDocument();
});
