/**
 * @jest-environment jsdom
 *
 * components/DateOfBirthInput.js — saisie clavier de la date de naissance en 3
 * champs (Jour/Mois/Année) : avance automatique, retour arrière vers le champ
 * précédent, collage d'une date complète, uniquement des chiffres, validation
 * affichée seulement après avoir quitté le groupe.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import DateOfBirthInput from "../components/DateOfBirthInput";

function dayInput() { return screen.getByLabelText("Jour de naissance"); }
function monthInput() { return screen.getByLabelText("Mois de naissance"); }
function yearInput() { return screen.getByLabelText("Année de naissance"); }

function pasteInto(input, text) {
  fireEvent.paste(input, { clipboardData: { getData: () => text } });
}

test("affiche 3 champs numériques avec les bons libellés/placeholders", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  expect(dayInput()).toHaveAttribute("placeholder", "JJ");
  expect(monthInput()).toHaveAttribute("placeholder", "MM");
  expect(yearInput()).toHaveAttribute("placeholder", "AAAA");
  expect(dayInput()).toHaveAttribute("inputMode", "numeric");
  expect(monthInput()).toHaveAttribute("inputMode", "numeric");
  expect(yearInput()).toHaveAttribute("inputMode", "numeric");
  expect(screen.getByText("Date de naissance")).toBeInTheDocument();
});

test("n'accepte aucun caractère non numérique", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  fireEvent.change(dayInput(), { target: { value: "a1b" } });
  expect(dayInput()).toHaveValue("1");
});

test("après 2 chiffres dans Jour, le focus passe automatiquement à Mois", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  fireEvent.change(dayInput(), { target: { value: "12" } });
  expect(monthInput()).toHaveFocus();
});

test("après 2 chiffres dans Mois, le focus passe automatiquement à Année", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  fireEvent.change(monthInput(), { target: { value: "04" } });
  expect(yearInput()).toHaveFocus();
});

test("un seul chiffre dans Jour ne fait pas encore avancer le focus", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  fireEvent.change(dayInput(), { target: { value: "1" } });
  expect(monthInput()).not.toHaveFocus();
});

test("retour arrière sur Mois vide renvoie le focus sur Jour", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  monthInput().focus();
  fireEvent.keyDown(monthInput(), { key: "Backspace" });
  expect(dayInput()).toHaveFocus();
});

test("retour arrière sur Année vide renvoie le focus sur Mois", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  yearInput().focus();
  fireEvent.keyDown(yearInput(), { key: "Backspace" });
  expect(monthInput()).toHaveFocus();
});

test("retour arrière sur un champ NON vide ne change pas le focus", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  monthInput().focus();
  fireEvent.change(monthInput(), { target: { value: "4" } });
  fireEvent.keyDown(monthInput(), { key: "Backspace" });
  expect(monthInput()).toHaveFocus();
});

test("collage d'une date complète \"12/04/1998\" remplit les 3 champs", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  pasteInto(dayInput(), "12/04/1998");
  expect(dayInput()).toHaveValue("12");
  expect(monthInput()).toHaveValue("04");
  expect(yearInput()).toHaveValue("1998");
});

test("collage d'une date complète sans séparateurs \"12041998\" remplit les 3 champs", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  pasteInto(dayInput(), "12041998");
  expect(dayInput()).toHaveValue("12");
  expect(monthInput()).toHaveValue("04");
  expect(yearInput()).toHaveValue("1998");
});

test("collage partiel (2 chiffres seulement) : ne perturbe pas les autres champs", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  pasteInto(dayInput(), "12");
  expect(monthInput()).toHaveValue("");
  expect(yearInput()).toHaveValue("");
});

test("appelle onChange avec le format AAAA-MM-JJ dès que la date est complète et valide, sans attendre le blur", () => {
  const onChange = jest.fn();
  render(<DateOfBirthInput onChange={onChange} />);
  fireEvent.change(dayInput(), { target: { value: "01" } });
  fireEvent.change(monthInput(), { target: { value: "06" } });
  fireEvent.change(yearInput(), { target: { value: "2000" } });
  expect(onChange).toHaveBeenLastCalledWith("2000-06-01");
});

test("aucune erreur affichée PENDANT la frappe, même avec un mois invalide", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  fireEvent.change(dayInput(), { target: { value: "01" } });
  fireEvent.change(monthInput(), { target: { value: "13" } });
  expect(screen.queryByText(/le mois doit être entre 1 et 12/i)).not.toBeInTheDocument();
});

test("erreur affichée seulement après avoir quitté le groupe des 3 champs", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  fireEvent.change(dayInput(), { target: { value: "01" } });
  fireEvent.change(monthInput(), { target: { value: "13" } });
  fireEvent.change(yearInput(), { target: { value: "2000" } });
  // Le focus quitte le groupe (relatedTarget = null, comme un vrai blur vers l'extérieur).
  fireEvent.blur(yearInput(), { relatedTarget: null });
  expect(screen.getByText("Le mois doit être entre 1 et 12.")).toBeInTheDocument();
});

test("pas d'erreur affichée quand on quitte Jour pour Mois (à l'intérieur du groupe)", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  fireEvent.change(dayInput(), { target: { value: "01" } });
  fireEvent.blur(dayInput(), { relatedTarget: monthInput() });
  expect(screen.queryByText(/le (jour|mois)/i)).not.toBeInTheDocument();
});

test("l'erreur disparaît dès qu'on reprend la frappe", () => {
  render(<DateOfBirthInput onChange={() => {}} />);
  fireEvent.change(dayInput(), { target: { value: "01" } });
  fireEvent.change(monthInput(), { target: { value: "13" } });
  fireEvent.change(yearInput(), { target: { value: "2000" } });
  fireEvent.blur(yearInput(), { relatedTarget: null });
  expect(screen.getByText("Le mois doit être entre 1 et 12.")).toBeInTheDocument();

  fireEvent.change(monthInput(), { target: { value: "06" } });
  expect(screen.queryByText("Le mois doit être entre 1 et 12.")).not.toBeInTheDocument();
});
