/**
 * lib/matchFilters.js — presentCompetitions ne doit plus être un filtre : toute
 * compétition réellement présente dans les matchs doit avoir un bouton de filtre
 * exploitable, y compris celles absentes de lib/competitions.js (n'importe quelle
 * fédération, n'importe quel pays, catégorie jeune comprise).
 */
import { presentCompetitions, presentMatchdays } from "../lib/matchFilters";

function match(code, name, matchday) {
  return { competition: { code, name }, matchday };
}

test("une compétition connue (lib/competitions.js) garde son nom soigné et son ordre de priorité habituel", () => {
  const matches = [match("FL1", "Ligue 1"), match("PL", "Premier League")];
  const result = presentCompetitions(matches);
  expect(result.map((c) => c.value)).toEqual(["PL", "FL1"]); // PL est prioritaire sur FL1 dans lib/competitions.js
  expect(result.find((c) => c.value === "PL").label).toBe("Premier League");
});

test("une compétition ABSENTE de lib/competitions.js apparaît quand même comme filtre, avec le nom fourni par le match", () => {
  const matches = [match("CLI", "Copa Libertadores")];
  const result = presentCompetitions(matches);
  expect(result).toEqual([{ value: "CLI", label: "Copa Libertadores" }]);
});

test("les compétitions connues apparaissent avant les compétitions inconnues, elles-mêmes triées alphabétiquement", () => {
  const matches = [match("ZZZ", "Zeta Zone Cup"), match("AAA", "Alpha Amateur Cup"), match("PL", "Premier League")];
  const result = presentCompetitions(matches);
  expect(result.map((c) => c.value)).toEqual(["PL", "AAA", "ZZZ"]);
});

test("aucun bouton pour une compétition sans aucun match derrière (pas de bouton vide)", () => {
  const matches = [match("PL", "Premier League")];
  const result = presentCompetitions(matches);
  expect(result.some((c) => c.value === "FL1")).toBe(false);
});

test("aucun match : aucune option", () => {
  expect(presentCompetitions([])).toEqual([]);
  expect(presentCompetitions(null)).toEqual([]);
});

test("une compétition sans code est ignorée plutôt que de casser le filtrage", () => {
  const matches = [{ competition: { name: "Sans code" } }, match("PL", "Premier League")];
  const result = presentCompetitions(matches);
  expect(result.map((c) => c.value)).toEqual(["PL"]);
});

test("presentMatchdays reste inchangé : journées réelles d'une compétition, triées, jamais une compétition sans champ matchday exploitable", () => {
  const matches = [match("PL", "Premier League", 3), match("PL", "Premier League", 1), match("FL1", "Ligue 1", 5)];
  expect(presentMatchdays(matches, "PL")).toEqual([
    { value: "1", label: "Journée 1" },
    { value: "3", label: "Journée 3" },
  ]);
  expect(presentMatchdays(matches, "CLI")).toEqual([]);
});
