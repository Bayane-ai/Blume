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

test("Europa League/Conference League et les championnats russe/suédois/slovaque/letton remontent juste après les compétitions majeures habituelles (jamais une liste séparée)", () => {
  const matches = [
    match("ZZZ", "Zeta Zone Cup"),
    { competition: { code: "af-235", name: "Premier League", area: "Russia" } },
    match("PL", "Premier League"),
    { competition: { code: "af-3", name: "UEFA Europa League" } },
  ];
  const result = presentCompetitions(matches);
  // PL (déjà connue) d'abord, puis les compétitions "spécifiques" (triées entre elles
  // par nom), puis tout le reste (alphabétique) — un seul et même filtre pour la liste
  // de matchs déjà affichée, jamais un doublon.
  expect(result.map((c) => c.value)).toEqual(["PL", "af-235", "af-3", "ZZZ"]);
});

test("presentMatchdays reste inchangé : journées réelles d'une compétition, triées, jamais une compétition sans champ matchday exploitable", () => {
  const matches = [match("PL", "Premier League", 3), match("PL", "Premier League", 1), match("FL1", "Ligue 1", 5)];
  expect(presentMatchdays(matches, "PL")).toEqual([
    { value: "1", label: "Journée 1" },
    { value: "3", label: "Journée 3" },
  ]);
  expect(presentMatchdays(matches, "CLI")).toEqual([]);
});
