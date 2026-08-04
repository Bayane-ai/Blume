/**
 * lib/featuredCompetitions.js — filtres purs pour les deux sections demandées
 * ("Ligue des Champions/Europa/Conference & championnats spécifiques" et "Matchs à
 * venir — tous les clubs"), bâtis sur les MÊMES matchs déjà récupérés par pages/api/
 * live-matches.js et pages/api/matches.js (football-data.org + API-Football, déjà
 * réels et testés) — jamais une nouvelle source de données.
 */
import { isFeaturedSpecificCompetition, rankForAllClubs, mergeLiveAndUpcoming, sortByStatusThenDate, sortByPriorityThenDate } from "../lib/featuredCompetitions";

function m(overrides) {
  return {
    id: "1", homeTeam: { name: "A" }, awayTeam: { name: "B" }, utcDate: "2026-08-10T18:00:00Z", status: "SCHEDULED",
    competition: { code: "", name: "", area: "" },
    ...overrides,
  };
}

describe("isFeaturedSpecificCompetition", () => {
  test("reconnaît la Ligue des Champions, Europa League et Conference League par nom (jamais de collision entre elles)", () => {
    expect(isFeaturedSpecificCompetition(m({ competition: { code: "CL", name: "UEFA Champions League" } }))).toBe(true);
    expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-3", name: "UEFA Europa League" } }))).toBe(true);
    expect(isFeaturedSpecificCompetition(m({ competition: { code: "af-848", name: "UEFA Europa Conference League" } }))).toBe(true);
    // L'Europa League ne doit jamais être confondue avec la Conference League.
    const europa = m({ competition: { code: "af-3", name: "UEFA Europa League" } });
    const conference = m({ competition: { code: "af-848", name: "UEFA Europa Conference League" } });
    expect(isFeaturedSpecificCompetition(europa)).toBe(true);
    expect(isFeaturedSpecificCompetition(conference)).toBe(true);
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
});

describe("rankForAllClubs / sortByPriorityThenDate", () => {
  test("LDC/Europa/Conference puis les 5 grands championnats, puis tout le reste — jamais un match exclu", () => {
    const cl = m({ id: "cl", competition: { code: "CL", name: "UEFA Champions League" } });
    const pl = m({ id: "pl", competition: { code: "PL", name: "Premier League" } });
    const other = m({ id: "other", competition: { code: "af-1", name: "Championnat inconnu" } });
    const sorted = sortByPriorityThenDate([other, pl, cl]);
    expect(sorted.map((x) => x.id)).toEqual(["cl", "pl", "other"]);
    expect(rankForAllClubs(cl)).toBeLessThan(rankForAllClubs(pl));
    expect(rankForAllClubs(pl)).toBeLessThan(rankForAllClubs(other));
  });
});

describe("mergeLiveAndUpcoming / sortByStatusThenDate", () => {
  test("déduplique par id, jamais de match sans équipes/horaire", () => {
    const live = [m({ id: "1", status: "IN_PLAY" })];
    const upcoming = [m({ id: "1", status: "IN_PLAY" }), m({ id: "2" }), { id: "3" }];
    const merged = mergeLiveAndUpcoming(live, upcoming);
    expect(merged.map((x) => x.id).sort()).toEqual(["1", "2"]);
  });

  test("trie en direct d'abord, puis par horaire croissant", () => {
    const soon = m({ id: "soon", status: "SCHEDULED", utcDate: "2026-08-11T00:00:00Z" });
    const later = m({ id: "later", status: "SCHEDULED", utcDate: "2026-08-12T00:00:00Z" });
    const live = m({ id: "live", status: "IN_PLAY", utcDate: "2026-08-10T00:00:00Z" });
    const sorted = sortByStatusThenDate([later, soon, live]);
    expect(sorted.map((x) => x.id)).toEqual(["live", "soon", "later"]);
  });
});
