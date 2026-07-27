/**
 * lib/matchFilters.js — presentCompetitions ne doit plus être un filtre : toute
 * compétition réellement présente dans les matchs doit avoir un bouton de filtre
 * exploitable, y compris celles absentes de lib/competitions.js (n'importe quelle
 * fédération, n'importe quel pays, catégorie jeune comprise).
 */
import { presentCompetitions, presentMatchdays, groupByLocalDay, groupMatchesByLocalDay } from "../lib/matchFilters";

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

// groupByLocalDay / groupMatchesByLocalDay (voir PROMPT, "Matchs à venir" :
// "groupés jour par jour par date... utilise le fuseau horaire de l'utilisateur pour
// le calcul des dates, pas UTC en dur"). Utilise des horaires à midi UTC pour chaque
// jour testé : reste sans ambiguïté à l'intérieur du même jour calendaire LOCAL quel
// que soit le fuseau de la machine qui exécute ces tests (décalage max ±14h).
function isoAtNoonUtc(daysFromEpochDay) {
  const d = new Date(Date.UTC(2026, 5, 1, 12, 0, 0)); // 2026-06-01T12:00:00Z, jour de référence
  d.setUTCDate(d.getUTCDate() + daysFromEpochDay);
  return d.toISOString();
}
const REF_NOW = new Date(isoAtNoonUtc(0));

test("groupMatchesByLocalDay : deux matchs le même jour local sont dans le même groupe, triés par heure", () => {
  const early = { id: "1", utcDate: new Date(Date.UTC(2026, 5, 1, 10, 0, 0)).toISOString() };
  const late = { id: "2", utcDate: new Date(Date.UTC(2026, 5, 1, 20, 0, 0)).toISOString() };
  const groups = groupMatchesByLocalDay([late, early], REF_NOW);
  expect(groups).toHaveLength(1);
  expect(groups[0].items.map((m) => m.id)).toEqual(["1", "2"]);
});

test("groupMatchesByLocalDay : deux jours différents -> deux groupes, dans l'ordre chronologique", () => {
  const today = { id: "today", utcDate: isoAtNoonUtc(0) };
  const in3days = { id: "later", utcDate: isoAtNoonUtc(3) };
  const groups = groupMatchesByLocalDay([in3days, today], REF_NOW);
  expect(groups).toHaveLength(2);
  expect(groups[0].items[0].id).toBe("today");
  expect(groups[1].items[0].id).toBe("later");
});

test('groupMatchesByLocalDay : le jour de "now" est étiqueté "Aujourd\'hui", le suivant "Demain"', () => {
  const groups = groupMatchesByLocalDay(
    [{ id: "a", utcDate: isoAtNoonUtc(0) }, { id: "b", utcDate: isoAtNoonUtc(1) }],
    REF_NOW
  );
  expect(groups[0].label).toBe("Aujourd'hui");
  expect(groups[1].label).toBe("Demain");
});

test("groupMatchesByLocalDay : un jour plus lointain reçoit une date complète lisible (jour de la semaine + jour + mois)", () => {
  const groups = groupMatchesByLocalDay([{ id: "a", utcDate: isoAtNoonUtc(5) }], REF_NOW);
  expect(groups[0].label).not.toBe("Aujourd'hui");
  expect(groups[0].label).not.toBe("Demain");
  expect(groups[0].label).toMatch(/^[A-ZÀ-Ü]/); // majuscule initiale
  expect(groups[0].label).toMatch(/juin|juillet/i);
});

test("groupMatchesByLocalDay : une entrée sans utcDate exploitable est ignorée sans faire planter le regroupement", () => {
  const groups = groupMatchesByLocalDay(
    [{ id: "valide", utcDate: isoAtNoonUtc(0) }, { id: "invalide", utcDate: null }, { id: "invalide2" }],
    REF_NOW
  );
  expect(groups).toHaveLength(1);
  expect(groups[0].items.map((m) => m.id)).toEqual(["valide"]);
});

test("groupByLocalDay : accepte un accesseur personnalisé, pour des éléments qui ne sont pas des matchs bruts (ex : { m, comp })", () => {
  const rows = [
    { m: { id: "1" }, comp: { code: "PL" }, utcDate: isoAtNoonUtc(0) },
    { m: { id: "2" }, comp: { code: "FL1" }, utcDate: isoAtNoonUtc(1) },
  ];
  const groups = groupByLocalDay(rows, (row) => row.utcDate, REF_NOW);
  expect(groups).toHaveLength(2);
  expect(groups[0].items[0].m.id).toBe("1");
  expect(groups[1].items[0].m.id).toBe("2");
});

test("groupMatchesByLocalDay : liste vide -> aucun groupe", () => {
  expect(groupMatchesByLocalDay([], REF_NOW)).toEqual([]);
  expect(groupMatchesByLocalDay(null, REF_NOW)).toEqual([]);
});
