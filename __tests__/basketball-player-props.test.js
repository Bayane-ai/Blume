/**
 * lib/sports/basketball/playerProps.js — bloc 3, point 12 "Joueurs à suivre" :
 * agrège les VRAIES lignes de statistiques par match (une ligne par joueur par
 * match) en moyennes réelles par joueur, jamais une valeur inventée ni un match
 * isolé, et jamais mélangée entre les deux équipes.
 */
import { buildPlayerProps } from "../lib/sports/basketball/playerProps";

function row(playerId, name, { points, totReb, assists, tpm, pFouls } = {}) {
  return { player: { id: playerId, name }, points, totReb, assists, tpm, pFouls };
}

test("équipe sans lignes de joueurs : blocs vides, jamais une valeur inventée", () => {
  const props = buildPlayerProps({ homeRows: [], awayRows: [] });
  expect(props.home.topScorer).toBeNull();
  expect(props.home.points).toEqual([]);
  expect(props.home.doubleDoubles).toEqual([]);
});

test("agrège plusieurs matchs du même joueur en une vraie moyenne (pas la valeur d'un seul match)", () => {
  const homeRows = [
    row(1, "Joueur A", { points: 20, totReb: 5, assists: 4, tpm: 2, pFouls: 2 }),
    row(1, "Joueur A", { points: 30, totReb: 7, assists: 6, tpm: 4, pFouls: 3 }),
    row(1, "Joueur A", { points: 25, totReb: 6, assists: 5, tpm: 3, pFouls: 2 }),
  ];
  const props = buildPlayerProps({ homeRows, awayRows: [] });
  // Moyenne réelle : (20+30+25)/3 = 25, jamais 20 ou 30 pris isolément.
  expect(props.home.topScorer.name).toBe("Joueur A");
  expect(props.home.topScorer.justification).toContain("25");
  expect(props.home.topScorer.justification).toContain("3 match");
});

test("le meilleur marqueur probable est celui avec la plus haute moyenne réelle de points", () => {
  const homeRows = [
    row(1, "Faible marqueur", { points: 8, totReb: 10, assists: 2, tpm: 0, pFouls: 3 }),
    row(1, "Faible marqueur", { points: 10, totReb: 12, assists: 3, tpm: 1, pFouls: 2 }),
    row(1, "Faible marqueur", { points: 9, totReb: 11, assists: 2, tpm: 0, pFouls: 3 }),
    row(2, "Fort marqueur", { points: 28, totReb: 4, assists: 6, tpm: 3, pFouls: 1 }),
    row(2, "Fort marqueur", { points: 32, totReb: 5, assists: 7, tpm: 4, pFouls: 2 }),
    row(2, "Fort marqueur", { points: 30, totReb: 3, assists: 5, tpm: 2, pFouls: 1 }),
  ];
  const props = buildPlayerProps({ homeRows, awayRows: [] });
  expect(props.home.topScorer.name).toBe("Fort marqueur");
});

test("jamais un arrondi de type pourcentage sur une moyenne de points (bug round1 corrigé)", () => {
  const homeRows = [
    row(1, "Joueur A", { points: 20 }),
    row(1, "Joueur A", { points: 21 }),
    row(1, "Joueur A", { points: 22 }),
  ];
  const props = buildPlayerProps({ homeRows, awayRows: [] });
  // Moyenne réelle = 21 — jamais 2100 (bug round1 utilisé comme arrondi générique).
  expect(props.home.topScorer.justification).toContain("21 points");
  expect(props.home.topScorer.justification).not.toContain("2100");
});

test("lignes +X,5 rebonds/passes/3 points/fautes réservées aux joueurs avec un échantillon suffisant (>=3 matchs)", () => {
  const homeRows = [
    row(1, "Un seul match", { points: 40, totReb: 15, assists: 10, tpm: 6, pFouls: 1 }),
    row(2, "Régulier", { points: 15, totReb: 12, assists: 8, tpm: 2, pFouls: 3 }),
    row(2, "Régulier", { points: 16, totReb: 13, assists: 9, tpm: 3, pFouls: 2 }),
    row(2, "Régulier", { points: 14, totReb: 11, assists: 7, tpm: 1, pFouls: 3 }),
  ];
  const props = buildPlayerProps({ homeRows, awayRows: [] });
  const reboundNames = props.home.rebounds.map((p) => p.name);
  expect(reboundNames).not.toContain("Un seul match");
  expect(reboundNames).toContain("Régulier");
});

test("double-double probable : au moins deux statistiques (pts/rbds/passes) à 10+ de moyenne réelle", () => {
  const homeRows = [
    row(1, "Double-double", { points: 18, totReb: 12, assists: 11, tpm: 1, pFouls: 2 }),
    row(1, "Double-double", { points: 20, totReb: 13, assists: 10, tpm: 2, pFouls: 3 }),
    row(1, "Double-double", { points: 19, totReb: 11, assists: 12, tpm: 1, pFouls: 2 }),
  ];
  const props = buildPlayerProps({ homeRows, awayRows: [] });
  expect(props.home.doubleDoubles.length).toBe(1);
  expect(props.home.doubleDoubles[0].name).toBe("Double-double");
});

test("les statistiques des deux équipes ne sont jamais mélangées", () => {
  const homeRows = [
    row(1, "Domicile", { points: 30, totReb: 10, assists: 5, tpm: 3, pFouls: 2 }),
    row(1, "Domicile", { points: 32, totReb: 11, assists: 6, tpm: 4, pFouls: 1 }),
    row(1, "Domicile", { points: 28, totReb: 9, assists: 4, tpm: 2, pFouls: 2 }),
  ];
  const awayRows = [
    row(2, "Extérieur", { points: 12, totReb: 8, assists: 3, tpm: 1, pFouls: 3 }),
    row(2, "Extérieur", { points: 10, totReb: 7, assists: 2, tpm: 0, pFouls: 4 }),
    row(2, "Extérieur", { points: 11, totReb: 9, assists: 3, tpm: 1, pFouls: 3 }),
  ];
  const props = buildPlayerProps({ homeRows, awayRows });
  expect(props.home.topScorer.name).toBe("Domicile");
  expect(props.away.topScorer.name).toBe("Extérieur");
  expect(props.away.points.map((p) => p.name)).not.toContain("Domicile");
});

test("champs alternatifs (rebounds/threePointersMade/fouls) acceptés en plus de totReb/tpm/pFouls", () => {
  const rows = [
    { player: { id: 1, name: "Alt" }, points: 15, rebounds: 8, assists: 4, threePointersMade: 2, fouls: 2 },
    { player: { id: 1, name: "Alt" }, points: 17, rebounds: 9, assists: 5, threePointersMade: 3, fouls: 1 },
    { player: { id: 1, name: "Alt" }, points: 16, rebounds: 7, assists: 3, threePointersMade: 1, fouls: 2 },
  ];
  const props = buildPlayerProps({ homeRows: rows, awayRows: [] });
  expect(props.home.rebounds.map((p) => p.name)).toContain("Alt");
});
