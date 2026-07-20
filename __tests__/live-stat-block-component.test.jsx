/**
 * @jest-environment jsdom
 *
 * components/LiveStatBlock.js — bloc générique réutilisé pour Corners / Hors-jeu /
 * Fautes / Touches : Total match, Total 1, Total 2, ligne mi-temps, jamais une cote ni
 * un pourcentage.
 */
import { render, screen } from "@testing-library/react";
import LiveStatBlock from "../components/LiveStatBlock";
import { computePronostic } from "../lib/pronostic";

function row({ id, goalsFor, goalsAgainst, playedGames = 20 }) {
  return { position: 5, points: 30, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

function basePronostic() {
  return computePronostic({
    homeRow: row({ id: 1, goalsFor: 45, goalsAgainst: 20 }),
    awayRow: row({ id: 2, goalsFor: 30, goalsAgainst: 28 }),
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
  });
}

const LINE_FORMAT = /^(Total match|Total 1|Total 2|1ère mi-temps|2ème mi-temps) : (Plus|Moins) de \d+,5$/;

test("affiche Total match, Total 1, Total 2 et la ligne mi-temps, toutes au format Plus/Moins de X,5", () => {
  const pronostic = basePronostic();
  render(<LiveStatBlock testId="stat-corners" title="Corners" block={pronostic.matchStats.corners} />);

  expect(screen.getByTestId("stat-corners-total")).toHaveTextContent(LINE_FORMAT);
  expect(screen.getByTestId("stat-corners-home")).toHaveTextContent(LINE_FORMAT);
  expect(screen.getByTestId("stat-corners-away")).toHaveTextContent(LINE_FORMAT);
  expect(screen.getByTestId("stat-corners-half")).toHaveTextContent(LINE_FORMAT);
});

test("aucune cote (ex : 1.85) ni pourcentage affiché", () => {
  const pronostic = basePronostic();
  const { container } = render(<LiveStatBlock testId="stat-corners" title="Corners" block={pronostic.matchStats.corners} />);
  expect(container.textContent).not.toMatch(/\b\d\.\d{2}\b/);
  expect(container.textContent).not.toMatch(/%/);
});

test("affiche la note quand elle est fournie, rien sinon", () => {
  const pronostic = basePronostic();
  const { rerender } = render(<LiveStatBlock testId="stat-corners" title="Corners" block={pronostic.matchStats.corners} note="Une note." />);
  expect(screen.getByText("Une note.")).toBeInTheDocument();

  rerender(<LiveStatBlock testId="stat-corners" title="Corners" block={pronostic.matchStats.corners} />);
  expect(screen.queryByText("Une note.")).not.toBeInTheDocument();
});

test("ne s'affiche pas (pas de carte vide/cassée) quand le bloc n'est pas disponible", () => {
  const { container } = render(<LiveStatBlock testId="stat-corners" title="Corners" block={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("la ligne mi-temps reflète bien le label du bloc (1ère ou 2ème selon le statut du match)", () => {
  const pronostic = basePronostic();
  render(<LiveStatBlock testId="stat-corners" title="Corners" block={pronostic.matchStats.corners} />);
  expect(screen.getByTestId("stat-corners-half")).toHaveTextContent(/^1ère mi-temps :/);
});
