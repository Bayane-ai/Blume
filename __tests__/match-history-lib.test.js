/**
 * @jest-environment jsdom
 *
 * lib/matchHistory.js — journal côté navigateur (localStorage) des matchs dont
 * l'utilisateur a déjà ouvert l'analyse/les pronostics (voir PROMPT "Historique") :
 * ajout en tête, jamais de doublon, jamais effacé par la fin du match, effacement
 * automatique ~10 jours après avoir été consulté.
 */
import { addMatchToHistory, listMatchHistory } from "../lib/matchHistory";

function entry(overrides = {}) {
  return {
    id: 1,
    status: "SCHEDULED",
    minute: null,
    utcDate: "2026-01-01T15:00:00Z",
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
    score: { fullTime: { home: null, away: null } },
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

test("un match sans entrée d'historique renvoie une liste vide", () => {
  expect(listMatchHistory()).toEqual([]);
});

test("ajouter un match l'ajoute en tête de l'historique avec un horodatage réel", () => {
  addMatchToHistory(entry({ id: 1 }));
  const list = listMatchHistory();
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe("1");
  expect(list[0].homeTeam.name).toBe("Arsenal FC");
  expect(Number.isFinite(list[0].addedAt)).toBe(true);
});

test("les matchs ajoutés ensuite passent en tête de liste (plus récent en premier)", () => {
  addMatchToHistory(entry({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } }));
  addMatchToHistory(entry({ id: 2, homeTeam: { id: 20, name: "Real Madrid", crest: "" } }));
  const list = listMatchHistory();
  expect(list.map((e) => e.id)).toEqual(["2", "1"]);
});

test("rouvrir un match déjà présent le remonte en haut au lieu de créer un doublon", () => {
  addMatchToHistory(entry({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } }));
  addMatchToHistory(entry({ id: 2, homeTeam: { id: 20, name: "Real Madrid", crest: "" } }));
  addMatchToHistory(entry({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } }));

  const list = listMatchHistory();
  expect(list).toHaveLength(2);
  expect(list.map((e) => e.id)).toEqual(["1", "2"]);
});

test("rouvrir un match déjà présent remet son délai d'effacement à zéro (nouvel addedAt)", () => {
  const oldTimestamp = Date.now() - 5 * 24 * 3600 * 1000; // il y a 5 jours
  jest.spyOn(Date, "now").mockReturnValue(oldTimestamp);
  addMatchToHistory(entry({ id: 1 }));
  Date.now.mockRestore();

  const beforeReopen = listMatchHistory();
  expect(beforeReopen[0].addedAt).toBe(oldTimestamp);

  addMatchToHistory(entry({ id: 1 })); // reconsulté maintenant
  const afterReopen = listMatchHistory();
  expect(afterReopen[0].addedAt).toBeGreaterThan(oldTimestamp);
});

test("un match reste dans l'historique même une fois terminé (pas effacé par la fin du match)", () => {
  addMatchToHistory(entry({ id: 1, status: "SCHEDULED" }));
  // Le match se termine ensuite, mais rien ne retire l'entrée automatiquement pour ça.
  const list = listMatchHistory();
  expect(list).toHaveLength(1);
});

test("une entrée disparaît automatiquement après ~10 jours", () => {
  const tenDaysAgo = Date.now() - 10.5 * 24 * 3600 * 1000;
  jest.spyOn(Date, "now").mockReturnValue(tenDaysAgo);
  addMatchToHistory(entry({ id: 1 }));
  Date.now.mockRestore();

  expect(listMatchHistory()).toEqual([]);
});

test("une entrée de moins de 10 jours reste dans l'historique", () => {
  const nineDaysAgo = Date.now() - 9 * 24 * 3600 * 1000;
  jest.spyOn(Date, "now").mockReturnValue(nineDaysAgo);
  addMatchToHistory(entry({ id: 1 }));
  Date.now.mockRestore();

  expect(listMatchHistory()).toHaveLength(1);
});

test("une entrée sans identifiant, sans équipe domicile ou sans équipe extérieure n'est jamais ajoutée (rien d'inventé)", () => {
  addMatchToHistory(entry({ id: null }));
  addMatchToHistory(entry({ homeTeam: null }));
  addMatchToHistory(entry({ awayTeam: null }));
  addMatchToHistory(null);
  expect(listMatchHistory()).toEqual([]);
});
