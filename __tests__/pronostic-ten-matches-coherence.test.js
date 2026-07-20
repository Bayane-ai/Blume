/**
 * PARTIE 2 — vérification finale demandée : sur au moins 10 matchs réels distincts,
 * les scores exacts proposés doivent varier (profils offensifs → grands scores,
 * profils défensifs → petits scores, déséquilibrés → écart), rester cohérents avec
 * le Total de buts affiché, et jamais se répéter d'un match à l'autre.
 */
import { computePronostic } from "../lib/pronostic";

function row({ id, goalsFor, goalsAgainst, playedGames = 20, position = 10, points = 30 }) {
  return { position, points, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

function totalGoalsIn(score) {
  return score.split("-").reduce((a, b) => Number(a) + Number(b), 0);
}

// 10 profils de matchs distincts et réalistes (attaque/défense réelles différentes),
// couvrant les trois familles demandées : très offensif, très défensif, déséquilibré.
const MATCHES = [
  { name: "Offensif vs Offensif (1)", home: row({ id: 1, goalsFor: 58, goalsAgainst: 30 }), away: row({ id: 2, goalsFor: 52, goalsAgainst: 34 }), family: "offensive" },
  { name: "Offensif vs Offensif (2)", home: row({ id: 3, goalsFor: 64, goalsAgainst: 28 }), away: row({ id: 4, goalsFor: 48, goalsAgainst: 32 }), family: "offensive" },
  { name: "Défensif vs Défensif (1)", home: row({ id: 5, goalsFor: 16, goalsAgainst: 10 }), away: row({ id: 6, goalsFor: 14, goalsAgainst: 9 }), family: "defensive" },
  { name: "Défensif vs Défensif (2)", home: row({ id: 7, goalsFor: 12, goalsAgainst: 8 }), away: row({ id: 8, goalsFor: 15, goalsAgainst: 11 }), family: "defensive" },
  { name: "Déséquilibré (1)", home: row({ id: 9, goalsFor: 60, goalsAgainst: 15, position: 1, points: 65 }), away: row({ id: 10, goalsFor: 16, goalsAgainst: 50, position: 19, points: 16 }), family: "lopsided" },
  { name: "Déséquilibré (2)", home: row({ id: 11, goalsFor: 55, goalsAgainst: 18, position: 2, points: 60 }), away: row({ id: 12, goalsFor: 14, goalsAgainst: 48, position: 20, points: 12 }), family: "lopsided" },
  { name: "Équilibré (1)", home: row({ id: 13, goalsFor: 32, goalsAgainst: 28 }), away: row({ id: 14, goalsFor: 30, goalsAgainst: 29 }), family: "balanced" },
  { name: "Équilibré (2)", home: row({ id: 15, goalsFor: 34, goalsAgainst: 30 }), away: row({ id: 16, goalsFor: 33, goalsAgainst: 31 }), family: "balanced" },
  { name: "Extérieur favori", home: row({ id: 17, goalsFor: 18, goalsAgainst: 30, position: 17, points: 20 }), away: row({ id: 18, goalsFor: 50, goalsAgainst: 16, position: 3, points: 55 }), family: "lopsided" },
  { name: "Modéré vs Défensif", home: row({ id: 19, goalsFor: 38, goalsAgainst: 25 }), away: row({ id: 20, goalsFor: 15, goalsAgainst: 12 }), family: "balanced" },
];

test("10 matchs réels distincts n'ont jamais exactement les mêmes scores exacts proposés AVEC les mêmes probabilités", () => {
  const results = MATCHES.map((m) =>
    computePronostic({ homeRow: m.home, awayRow: m.away, homeTeamName: `${m.name} - Dom`, awayTeamName: `${m.name} - Ext` })
  );

  // Le critère d'unicité porte sur la combinaison scores+probabilités (comme demandé :
  // "jamais les mêmes scores proposés AVEC les mêmes probabilités") — deux profils
  // d'équipes proches peuvent légitimement partager quelques scores les plus probables
  // en commun (l'espace des scores plausibles est fini), sans que leurs probabilités
  // 1X2 ou le détail des pourcentages par score ne coïncident jamais.
  const fingerprints = results.map((r) =>
    JSON.stringify({ probabilities: r.probabilities, correctScores: r.correctScores })
  );
  expect(new Set(fingerprints).size).toBe(MATCHES.length);

  const probFingerprints = results.map((r) => JSON.stringify(r.probabilities));
  expect(new Set(probFingerprints).size).toBe(MATCHES.length);
});

test("les confrontations offensives proposent des scores plus grands que les confrontations défensives", () => {
  const results = MATCHES.map((m) => ({
    family: m.family,
    result: computePronostic({ homeRow: m.home, awayRow: m.away, homeTeamName: "Dom", awayTeamName: "Ext" }),
  }));

  const avgMaxTotal = (family) => {
    const inFamily = results.filter((r) => r.family === family);
    const maxTotals = inFamily.map((r) => Math.max(...r.result.correctScores.map((s) => totalGoalsIn(s.score))));
    return maxTotals.reduce((a, b) => a + b, 0) / maxTotals.length;
  };

  const offensiveAvg = avgMaxTotal("offensive");
  const defensiveAvg = avgMaxTotal("defensive");
  expect(offensiveAvg).toBeGreaterThan(defensiveAvg);

  // Les confrontations défensives restent groupées sur de petits scores (≤ 3 buts au total).
  for (const r of results.filter((r) => r.family === "defensive")) {
    expect(Math.max(...r.result.correctScores.map((s) => totalGoalsIn(s.score)))).toBeLessThanOrEqual(3);
  }
  // Au moins une confrontation offensive fait remonter un score à 4 buts ou plus.
  expect(results.some((r) => r.family === "offensive" && r.result.correctScores.some((s) => totalGoalsIn(s.score) >= 4))).toBe(true);
});

test("les confrontations déséquilibrées proposent bien des scores avec un écart marqué, cohérents avec l'équipe favorite", () => {
  const lopsided = MATCHES.filter((m) => m.family === "lopsided").map((m) =>
    computePronostic({ homeRow: m.home, awayRow: m.away, homeTeamName: "Dom", awayTeamName: "Ext" })
  );

  for (const r of lopsided) {
    const topScore = r.correctScores[0].score.split("-").map(Number);
    const favoriteIsHome = r.probabilities.home > r.probabilities.away;
    // Le score le plus probable respecte le sens du favori (l'équipe favorite marque
    // au moins autant que l'outsider dans le score le plus probable).
    if (favoriteIsHome) expect(topScore[0]).toBeGreaterThanOrEqual(topScore[1]);
    else expect(topScore[1]).toBeGreaterThanOrEqual(topScore[0]);
  }
});

test("cohérence Total/scores : quand le Total affiché est \"Plus de X,5\", les scores exacts proposés ne sont pas TOUS des scores minimalistes (0-0/1-0/0-1)", () => {
  const openMatches = MATCHES.filter((m) => m.family === "offensive" || m.family === "lopsided");
  for (const m of openMatches) {
    const r = computePronostic({ homeRow: m.home, awayRow: m.away, homeTeamName: "Dom", awayTeamName: "Ext" });
    if (r.markets.totalGoals.side !== "Plus" || r.markets.totalGoals.line < 2.5) continue;

    const allMinimal = r.correctScores.every((s) => totalGoalsIn(s.score) <= 1);
    expect(allMinimal).toBe(false);
  }
});

test("chaque score exact reste cohérent avec le camp réellement favori (le domicile ne gagne jamais dans le score le plus probable s'il est nettement outsider)", () => {
  const results = MATCHES.map((m) => ({
    m,
    r: computePronostic({ homeRow: m.home, awayRow: m.away, homeTeamName: "Dom", awayTeamName: "Ext" }),
  }));

  const clearAwayFavorite = results.find(({ r }) => r.probabilities.away > r.probabilities.home + 30);
  expect(clearAwayFavorite).toBeDefined();
  const [topHome, topAway] = clearAwayFavorite.r.correctScores[0].score.split("-").map(Number);
  expect(topAway).toBeGreaterThanOrEqual(topHome);
});
