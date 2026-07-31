/**
 * @jest-environment jsdom
 *
 * components/SportComingSoon.js — état affiché à la place du contenu réel pour un
 * sport pas encore branché (basket/tennis, voir bloc 0) : jamais une erreur, jamais
 * une page blanche, jamais une donnée inventée.
 */
import { render, screen } from "@testing-library/react";
import SportComingSoon from "../components/SportComingSoon";

test("affiche un message clair et contextuel pour le basket, jamais un texte d'erreur", () => {
  render(<SportComingSoon sport="basketball" pageLabel="Matchs à venir" />);
  const card = screen.getByTestId("sport-coming-soon");
  expect(card.textContent).toMatch(/Basket/);
  expect(card.textContent).toMatch(/Matchs à venir/);
  expect(card.textContent).not.toMatch(/erreur/i);
});

test("affiche un message clair et contextuel pour le tennis", () => {
  render(<SportComingSoon sport="tennis" pageLabel="Combiné Vision" />);
  const card = screen.getByTestId("sport-coming-soon");
  expect(card.textContent).toMatch(/Tennis/);
  expect(card.textContent).toMatch(/Combiné Vision/);
});

test("ne plante jamais pour un id de sport inconnu (retombe sur football)", () => {
  render(<SportComingSoon sport="rugby" pageLabel="Test" />);
  expect(screen.getByTestId("sport-coming-soon")).toBeInTheDocument();
});
