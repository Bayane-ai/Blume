/**
 * @jest-environment jsdom
 *
 * components/SportTabs.js — sélecteur à 3 onglets (Football | Basket | Tennis), même
 * style que le reste de l'app.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import SportTabs from "../components/SportTabs";

test("affiche les 3 onglets, avec le sport actif marqué (aria-selected)", () => {
  render(<SportTabs sport="football" onChange={() => {}} />);
  expect(screen.getByTestId("sport-tab-football")).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("sport-tab-basketball")).toHaveAttribute("aria-selected", "false");
  expect(screen.getByTestId("sport-tab-tennis")).toHaveAttribute("aria-selected", "false");
  expect(screen.getByText(/Football/)).toBeInTheDocument();
  expect(screen.getByText(/Basket/)).toBeInTheDocument();
  expect(screen.getByText(/Tennis/)).toBeInTheDocument();
});

test("cliquer sur un onglet appelle bien onChange avec le bon id de sport", () => {
  const onChange = jest.fn();
  render(<SportTabs sport="football" onChange={onChange} />);

  fireEvent.click(screen.getByTestId("sport-tab-basketball"));
  expect(onChange).toHaveBeenCalledWith("basketball");

  fireEvent.click(screen.getByTestId("sport-tab-tennis"));
  expect(onChange).toHaveBeenCalledWith("tennis");
});

test("aucun onglet mort : les 3 sont de vrais <button>, jamais un texte non cliquable", () => {
  render(<SportTabs sport="basketball" onChange={() => {}} />);
  expect(screen.getAllByRole("tab")).toHaveLength(3);
});
