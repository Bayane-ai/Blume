/**
 * lib/probableScorers.js — filtre les vrais buteurs/passeurs d'une compétition sur
 * les joueurs de CHAQUE équipe, sans jamais les mélanger, et sans jamais inventer un
 * joueur quand la donnée est absente.
 */
import { buildProbableScorers } from "../lib/probableScorers";

function scorer(name, teamId, goals, assists = 0, playerId) {
  return { player: { id: playerId ?? name, name }, team: { id: teamId }, goals, assists };
}

test("sépare correctement les buteurs de chaque équipe — jamais mélangés", () => {
  const scorers = [
    scorer("Bukayo Saka", 10, 12, 6),
    scorer("Kai Havertz", 10, 8, 3),
    scorer("Cole Palmer", 11, 15, 9),
    scorer("Nicolas Jackson", 11, 10, 2),
  ];

  const result = buildProbableScorers(scorers, 10, 11);

  expect(result.home.scorers.map((p) => p.name)).toEqual(["Bukayo Saka", "Kai Havertz"]);
  expect(result.away.scorers.map((p) => p.name)).toEqual(["Cole Palmer", "Nicolas Jackson"]);
  // Aucun nom de l'équipe adverse ne fuite dans l'autre colonne.
  expect(result.home.scorers.some((p) => p.name === "Cole Palmer")).toBe(false);
  expect(result.away.scorers.some((p) => p.name === "Bukayo Saka")).toBe(false);
});

test("trie les buteurs par nombre de buts décroissant, avec le vrai total affiché", () => {
  const scorers = [scorer("A", 10, 3), scorer("B", 10, 9), scorer("C", 10, 5)];
  const result = buildProbableScorers(scorers, 10, 999);
  expect(result.home.scorers.map((p) => p.name)).toEqual(["B", "C", "A"]);
  expect(result.home.scorers.map((p) => p.goals)).toEqual([9, 5, 3]);
});

test("trie les passeurs décisifs séparément, par passes décisives décroissantes", () => {
  const scorers = [
    scorer("Buteur pur", 10, 15, 0),
    scorer("Passeur", 10, 2, 10),
  ];
  const result = buildProbableScorers(scorers, 10, 999);
  expect(result.home.scorers[0].name).toBe("Buteur pur");
  expect(result.home.assists[0].name).toBe("Passeur");
  expect(result.home.assists[0].assists).toBe(10);
});

test("un joueur avec 0 but n'apparaît pas comme buteur probable (mais peut apparaître comme passeur s'il a des passes décisives)", () => {
  const scorers = [scorer("Milieu créateur", 10, 0, 7)];
  const result = buildProbableScorers(scorers, 10, 999);
  expect(result.home.scorers).toHaveLength(0);
  expect(result.home.assists).toHaveLength(1);
  expect(result.home.assists[0].name).toBe("Milieu créateur");
});

test("plafonne à 4 buteurs et 3 passeurs maximum par équipe", () => {
  const scorers = Array.from({ length: 10 }, (_, i) => scorer(`Joueur ${i}`, 10, 10 - i, 10 - i));
  const result = buildProbableScorers(scorers, 10, 999);
  expect(result.home.scorers).toHaveLength(4);
  expect(result.home.assists).toHaveLength(3);
});

test("aucune donnée disponible (scorers null) : listes vides pour les deux équipes, jamais un plantage ni un joueur inventé", () => {
  const result = buildProbableScorers(null, 10, 11);
  expect(result.home.scorers).toEqual([]);
  expect(result.home.assists).toEqual([]);
  expect(result.away.scorers).toEqual([]);
  expect(result.away.assists).toEqual([]);
});

test("une équipe absente du classement des buteurs (aucun joueur assez prolifique) reste honnêtement vide, sans inventer un joueur pour combler", () => {
  const scorers = [scorer("Vedette adverse", 11, 20, 10)];
  const result = buildProbableScorers(scorers, 10, 11);
  expect(result.home.scorers).toEqual([]);
  expect(result.away.scorers).toHaveLength(1);
});

test("deux matchs différents (équipes différentes) produisent des listes différentes — jamais recopiées d'un match à l'autre", () => {
  const scorersMatch1 = [scorer("Joueur A", 10, 12, 4), scorer("Joueur B", 11, 8, 2)];
  const scorersMatch2 = [scorer("Joueur C", 20, 18, 6), scorer("Joueur D", 21, 3, 9)];

  const r1 = buildProbableScorers(scorersMatch1, 10, 11);
  const r2 = buildProbableScorers(scorersMatch2, 20, 21);

  expect(JSON.stringify(r1)).not.toBe(JSON.stringify(r2));
});
