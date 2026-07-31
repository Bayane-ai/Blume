/**
 * @jest-environment jsdom
 *
 * components/LineJustification.js — PROMPT 2 : texte de justification discret sous
 * une ligne chiffrée, avec son niveau de confiance (faible/moyen/élevé) quand connu.
 */
import { render, screen } from "@testing-library/react";
import LineJustification from "../components/LineJustification";

test("affiche le texte et la confiance quand les deux sont fournis", () => {
  render(<LineJustification narrative={{ text: "Ligne fixée sur les vraies stats des deux équipes.", confidence: "moyen" }} />);
  expect(screen.getByText(/Ligne fixée sur les vraies stats des deux équipes\./)).toBeInTheDocument();
  expect(screen.getByText(/Confiance : moyen/)).toBeInTheDocument();
});

test("affiche le texte sans confiance quand la confiance est indisponible (ex : donnée absente)", () => {
  render(<LineJustification narrative={{ text: "Indisponible pour ce match.", confidence: null }} />);
  expect(screen.getByText("Indisponible pour ce match.")).toBeInTheDocument();
  expect(screen.queryByText(/Confiance :/)).not.toBeInTheDocument();
});

test("ne rend rien quand aucune narrative n'est fournie (pas de bloc vide/cassé)", () => {
  const { container } = render(<LineJustification narrative={null} />);
  expect(container).toBeEmptyDOMElement();
});
