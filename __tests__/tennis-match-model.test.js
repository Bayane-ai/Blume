/**
 * lib/sports/tennis/matchModel.js — vérifie que le modèle mathématique (chaîne de
 * Markov jeu -> set -> match) est cohérent : les probabilités somment à 1, deux
 * joueurs strictement identiques donnent 50/50, un joueur clairement meilleur est
 * favori, et les grandeurs dérivées (jeux attendus, jeu décisif, breaks) restent dans
 * des bornes réalistes.
 */
const {
  raceToNWinProb, gameWinProb, tiebreakWinProb, simulateSet, simulateSetSymmetric,
  setScoreDistribution, matchWinProbFromSetProb, expectedSetsPlayed,
  matchWinProbFromState, setScoreDistributionFromState, expectedAdditionalSetsFromState,
} = require("../lib/sports/tennis/matchModel");

describe("raceToNWinProb / gameWinProb", () => {
  test("p=0.5 (joueurs identiques) -> 50 % de gagner un jeu", () => {
    expect(gameWinProb(0.5)).toBeCloseTo(0.5, 5);
  });

  test("un joueur qui gagne presque tous ses points de service gagne quasiment tous ses jeux", () => {
    expect(gameWinProb(0.9)).toBeGreaterThan(0.99);
  });

  test("un joueur qui perd presque tous ses points de service perd quasiment tous ses jeux", () => {
    expect(gameWinProb(0.1)).toBeLessThan(0.01);
  });

  test("monotone : plus p augmente, plus la probabilité de gagner le jeu augmente", () => {
    const values = [0.3, 0.4, 0.5, 0.6, 0.7].map(gameWinProb);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });

  test("borne p à [0,1] plutôt que de produire une probabilité invalide", () => {
    expect(raceToNWinProb(-0.2, 4, 2)).toBe(0);
    expect(raceToNWinProb(1.5, 4, 2)).toBe(1);
  });
});

describe("tiebreakWinProb", () => {
  test("deux joueurs identiques -> 50 %", () => {
    expect(tiebreakWinProb(0.65, 0.65)).toBeCloseTo(0.5, 5);
  });

  test("joueur 1 nettement meilleur au service ET au retour -> largement favori", () => {
    expect(tiebreakWinProb(0.75, 0.55)).toBeGreaterThan(0.7);
  });
});

describe("simulateSet — chaîne de Markov sur le score en jeux", () => {
  test("deux joueurs identiques (même probabilité de tenir leur service) -> 50/50 sur le set", () => {
    const result = simulateSet(0.65, 0.65);
    expect(result.p1WinProb).toBeCloseTo(0.5, 4);
  });

  test("joueur 1 au service beaucoup plus fiable -> favori sur le set", () => {
    const result = simulateSet(0.85, 0.55);
    expect(result.p1WinProb).toBeGreaterThan(0.7);
  });

  test("jeux attendus réalistes (entre 6 et 13 pour un set, jamais négatifs ni aberrants)", () => {
    const result = simulateSet(0.65, 0.6);
    expect(result.expectedGames).toBeGreaterThanOrEqual(6);
    expect(result.expectedGames).toBeLessThanOrEqual(13);
  });

  test("la somme des jeux gagnés par chacun égale le total de jeux attendu", () => {
    const result = simulateSet(0.7, 0.55);
    expect(result.expectedP1Games + result.expectedP2Games).toBeCloseTo(result.expectedGames, 5);
  });

  test("deux services très solides (peu de breaks) -> probabilité de jeu décisif plus élevée qu'avec des services fragiles", () => {
    const solid = simulateSet(0.85, 0.85);
    const fragile = simulateSet(0.55, 0.55);
    expect(solid.tiebreakProb).toBeGreaterThan(fragile.tiebreakProb);
  });

  test("des services très fragiles produisent plus de breaks attendus que des services solides", () => {
    const solid = simulateSet(0.85, 0.85);
    const fragile = simulateSet(0.55, 0.55);
    expect(fragile.breaksP1 + fragile.breaksP2).toBeGreaterThan(solid.breaksP1 + solid.breaksP2);
  });

  test("reprend correctement à partir d'un score en cours (recalcul en direct) : moins de jeux restants qu'en partant de 0-0", () => {
    const fromStart = simulateSet(0.65, 0.6);
    const fromMidSet = simulateSet(0.65, 0.6, { startG1: 4, startG2: 3, firstServerIsP1: true });
    expect(fromMidSet.expectedGames).toBeLessThan(fromStart.expectedGames);
  });

  test("un joueur déjà mené 0-5 dans le set a une probabilité de le gagner proche de 0", () => {
    const result = simulateSet(0.65, 0.65, { startG1: 0, startG2: 5, firstServerIsP1: true });
    expect(result.p1WinProb).toBeLessThan(0.15);
  });
});

describe("simulateSetSymmetric — élimine l'avantage du premier service", () => {
  test("deux joueurs identiques -> exactement 50/50, quel que soit qui sert en premier", () => {
    const result = simulateSetSymmetric(0.65, 0.65);
    expect(result.p1WinProb).toBeCloseTo(0.5, 5);
  });
});

describe("setScoreDistribution — somme à 1, cohérente avec matchWinProbFromSetProb", () => {
  test("meilleur des 3 sets : les 4 scores possibles somment à 1", () => {
    const dist = setScoreDistribution(0.6, 3);
    expect(dist).toHaveLength(4);
    const total = dist.reduce((s, d) => s + d.probability, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  test("meilleur des 5 sets (Grand Chelem) : les 6 scores possibles somment à 1", () => {
    const dist = setScoreDistribution(0.6, 5);
    expect(dist).toHaveLength(6);
    const total = dist.reduce((s, d) => s + d.probability, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  test("matchWinProbFromSetProb = somme des scores gagnants du joueur 1", () => {
    const pSet = 0.62;
    const winProb = matchWinProbFromSetProb(pSet, 3);
    const manual = setScoreDistribution(pSet, 3)
      .filter((d) => d.winner === "p1")
      .reduce((s, d) => s + d.probability, 0);
    expect(winProb).toBeCloseTo(manual, 8);
  });

  test("pSet=0.5 -> probabilité de match exactement 50/50", () => {
    expect(matchWinProbFromSetProb(0.5, 3)).toBeCloseTo(0.5, 6);
    expect(matchWinProbFromSetProb(0.5, 5)).toBeCloseTo(0.5, 6);
  });

  test("un net favori par set l'est encore plus sur l'ensemble du match (meilleur des 3 amplifie l'écart)", () => {
    const pSet = 0.65;
    const matchProb = matchWinProbFromSetProb(pSet, 3);
    expect(matchProb).toBeGreaterThan(pSet);
  });

  test("un Grand Chelem (5 sets) amplifie encore plus l'écart qu'un meilleur des 3 pour le même favori", () => {
    const pSet = 0.6;
    const bo3 = matchWinProbFromSetProb(pSet, 3);
    const bo5 = matchWinProbFromSetProb(pSet, 5);
    expect(bo5).toBeGreaterThan(bo3);
  });
});

describe("expectedSetsPlayed", () => {
  test("match équilibré (50/50) : proche de 2,5 sets en moyenne au meilleur des 3", () => {
    expect(expectedSetsPlayed(0.5, 3)).toBeGreaterThan(2.3);
    expect(expectedSetsPlayed(0.5, 3)).toBeLessThan(2.6);
  });

  test("un net favori termine le match plus vite (moins de sets attendus) qu'un match équilibré", () => {
    expect(expectedSetsPlayed(0.9, 3)).toBeLessThan(expectedSetsPlayed(0.5, 3));
  });

  test("toujours entre le minimum (2 sets en Bo3) et le maximum (3 sets en Bo3) possibles", () => {
    for (const p of [0.3, 0.5, 0.7, 0.9]) {
      const e = expectedSetsPlayed(p, 3);
      expect(e).toBeGreaterThanOrEqual(2);
      expect(e).toBeLessThanOrEqual(3);
    }
  });
});

describe("matchWinProbFromState — recalcul en direct à partir du score en sets déjà acquis", () => {
  test("état 0-0 = exactement matchWinProbFromSetProb (cas particulier)", () => {
    const pSet = 0.62;
    expect(matchWinProbFromState(pSet, 3, 0, 0)).toBeCloseTo(matchWinProbFromSetProb(pSet, 3), 8);
  });

  test("joueur 1 mène déjà 1 set à 0 (Bo3) : sa probabilité de gagner le match augmente par rapport à 0-0", () => {
    const pSet = 0.55;
    const atStart = matchWinProbFromState(pSet, 3, 0, 0);
    const leading = matchWinProbFromState(pSet, 3, 1, 0);
    expect(leading).toBeGreaterThan(atStart);
  });

  test("joueur 1 a déjà gagné le nombre de sets requis -> 100 % (match déjà gagné)", () => {
    expect(matchWinProbFromState(0.5, 3, 2, 1)).toBe(1);
    expect(matchWinProbFromState(0.5, 5, 3, 2)).toBe(1);
  });

  test("joueur 1 a déjà perdu le nombre de sets requis par l'adversaire -> 0 %", () => {
    expect(matchWinProbFromState(0.5, 3, 0, 2)).toBe(0);
  });
});

describe("setScoreDistributionFromState", () => {
  test("état 0-0 : somme à 1, identique à setScoreDistribution", () => {
    const dist = setScoreDistributionFromState(0.6, 3, 0, 0);
    const total = dist.reduce((s, d) => s + d.probability, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  test("joueur 1 mène déjà 1-0 (Bo3) : tous les scores finaux possibles commencent bien par ce set déjà acquis", () => {
    const dist = setScoreDistributionFromState(0.6, 3, 1, 0);
    for (const d of dist) {
      const [a, b] = d.score.split("-").map(Number);
      if (d.winner === "p1") expect(a).toBeGreaterThanOrEqual(1);
    }
    const total = dist.reduce((s, d) => s + d.probability, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});

describe("expectedAdditionalSetsFromState", () => {
  test("0-0 (Bo3) : entre 2 et 3 sets restants attendus", () => {
    const e = expectedAdditionalSetsFromState(0.5, 3, 0, 0);
    expect(e).toBeGreaterThanOrEqual(2);
    expect(e).toBeLessThanOrEqual(3);
  });

  test("match déjà terminé (2-0 en Bo3) : 0 set restant", () => {
    expect(expectedAdditionalSetsFromState(0.5, 3, 2, 0)).toBe(0);
  });

  test("1 set partout (Bo3, 3e et dernier set à jouer) : exactement 1 set restant", () => {
    expect(expectedAdditionalSetsFromState(0.5, 3, 1, 1)).toBe(1);
  });
});
