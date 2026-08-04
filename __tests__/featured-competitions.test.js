/**
 * lib/featuredCompetitions.js — détecte si un match appartient aux compétitions
 * demandées explicitement (Ligue des Champions, Europa League, Conference League,
 * 1ère division russe/suédoise/slovaque/lettone). Utilisé UNIQUEMENT pour faire
 * remonter ces compétitions en tête du carrousel de filtres déjà existant (voir
 * lib/matchFilters.js#presentCompetitions et __tests__/match-filters.test.js) — jamais
 * pour afficher une liste de matchs séparée (aucun match ne doit être dupliqué sur la
 * page).
 */
import { isFeaturedSpecificCompetition } from "../lib/featuredCompetitions";

function m(overrides) {
  return { competition: { code: "", name: "", area: "" }, ...overrides };
}

test("reconnaît la Ligue des Champions, Europa League et Conference League par nom (jamais de collision entre elles)", () => {
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "CL", name: "UEFA Champions League" } }))).toBe(true);
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-3", name: "UEFA Europa League" } }))).toBe(true);
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-848", name: "UEFA Europa Conference League" } }))).toBe(true);
});

test("reconnaît la 1ère division russe/suédoise/slovaque/lettone par pays réel (competition.area)", () => {
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-235", name: "Premier League", area: "Russia" } }))).toBe(true);
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-113", name: "Allsvenskan", area: "Sweden" } }))).toBe(true);
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-332", name: "Niké Liga", area: "Slovakia" } }))).toBe(true);
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-365", name: "Virsliga", area: "Latvia" } }))).toBe(true);
  // Insensible à la casse.
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-235", name: "Premier League", area: "RUSSIA" } }))).toBe(true);
});

test("exclut les coupes/réserves/jeunes/féminines de ces 4 pays (best-effort, jamais une certitude absolue)", () => {
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-999", name: "Russian Cup", area: "Russia" } }))).toBe(false);
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-998", name: "Allsvenskan U21", area: "Sweden" } }))).toBe(false);
});

test("ignore les championnats nationaux \"classiques\" (Premier League Angleterre, LaLiga...) — pas dans les 4 pays demandés", () => {
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "PL", name: "Premier League", area: "England" } }))).toBe(false);
  expect(isFeaturedSpecificCompetition(m({ competition: { code: "PD", name: "LaLiga", area: "Spain" } }))).toBe(false);
});

test("jamais un plantage si competition est absent/vide", () => {
  expect(() => isFeaturedSpecificCompetition({})).not.toThrow();
  expect(isFeaturedSpecificCompetition({})).toBe(false);
});
