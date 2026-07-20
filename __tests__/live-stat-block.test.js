/**
 * lib/pronostic.js — buildMatchStats : les 4 blocs "Corners / Hors-jeu / Fautes /
 * Touches" (voir components/LiveStatBlock.js). Chaque bloc a la même structure (Total
 * match, Total 1, Total 2, ligne "1ère mi-temps") et la même logique — calculée UNE
 * SEULE FOIS à partir des vraies statistiques des deux équipes, jamais recalculée
 * pendant le match (correction demandée après coup : computeLivePronostic, qui
 * recalculait ces lignes à partir du score/de la minute/du vrai rythme observé en
 * direct, a été retiré).
 */
import { computePronostic } from "../lib/pronostic";

function row({ id, goalsFor, goalsAgainst, playedGames = 20 }) {
  return { position: 5, points: 30, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

function baseTeams() {
  return {
    homeRow: row({ id: 1, goalsFor: 45, goalsAgainst: 20 }),
    awayRow: row({ id: 2, goalsFor: 30, goalsAgainst: 28 }),
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
  };
}

const BLOCKS = ["corners", "offsides", "fouls", "throwIns"];

test("les 4 blocs sont présents, chacun avec Total match/1/2 en Plus/Moins de X,5 et une ligne 1ère mi-temps", () => {
  const pronostic = computePronostic(baseTeams());
  expect(pronostic.matchStats).toBeDefined();
  for (const key of BLOCKS) {
    const block = pronostic.matchStats[key];
    for (const market of [block.total, block.home, block.away, block.half.market]) {
      expect(market.side).toMatch(/^Plus|Moins$/);
      expect(market.line % 1).toBeCloseTo(0.5, 5);
    }
  }
});

test("la ligne mi-temps affiche toujours \"1ère mi-temps\" (jamais de bascule en cours de match, voir correction demandée)", () => {
  const pronostic = computePronostic(baseTeams());
  for (const key of BLOCKS) {
    expect(pronostic.matchStats[key].half.label).toBe("1ère mi-temps");
  }
});

// Pronostics figés : computePronostic ne prend plus aucun paramètre lié au direct
// (score, minute, statut) — deux appels avec les mêmes équipes doivent donc toujours
// renvoyer EXACTEMENT le même matchStats, comme si on l'appelait à n'importe quel
// instant du match.
test("deux appels avec les mêmes équipes renvoient un matchStats strictement identique, pour les 4 blocs", () => {
  const teams = baseTeams();
  const first = computePronostic(teams);
  const second = computePronostic(teams);
  for (const key of BLOCKS) {
    expect(second.matchStats[key]).toEqual(first.matchStats[key]);
  }
});

test("deux matchs différents affichent des lignes différentes pour les 4 blocs — jamais recopiées d'un match à l'autre", () => {
  const m1 = computePronostic(baseTeams());
  const m2 = computePronostic({
    homeRow: row({ id: 3, goalsFor: 15, goalsAgainst: 40 }),
    awayRow: row({ id: 4, goalsFor: 40, goalsAgainst: 15 }),
    homeTeamName: "Défense A", awayTeamName: "Attaque B",
  });

  for (const key of BLOCKS) {
    const fingerprint = (p) => JSON.stringify(p.matchStats[key]);
    expect(fingerprint(m1)).not.toBe(fingerprint(m2));
  }
});
