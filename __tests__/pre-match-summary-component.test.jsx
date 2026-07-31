/**
 * @jest-environment jsdom
 *
 * components/PreMatchSummary.js — PROMPT 2 : résumé d'avant-match en haut de la page
 * pronostics (voir lib/matchNarrative.js, buildPreMatchSummary) — quelques phrases,
 * jamais un texte générique recopié d'un match à l'autre.
 */
import { render, screen } from "@testing-library/react";
import PreMatchSummary from "../components/PreMatchSummary";

test("affiche le résumé quand il est disponible", () => {
  render(<PreMatchSummary pronostic={{ available: true, narrative: { preMatchSummary: "Lions FC domine largement Renards FC cette saison." } }} />);
  expect(screen.getByText("Lions FC domine largement Renards FC cette saison.")).toBeInTheDocument();
  expect(screen.getByText("Avant-match")).toBeInTheDocument();
});

test("ne rend rien quand le pronostic est indisponible", () => {
  const { container } = render(<PreMatchSummary pronostic={{ available: false }} />);
  expect(container).toBeEmptyDOMElement();
});

test("ne rend rien quand aucun résumé n'a été calculé", () => {
  const { container } = render(<PreMatchSummary pronostic={{ available: true, narrative: {} }} />);
  expect(container).toBeEmptyDOMElement();
});
