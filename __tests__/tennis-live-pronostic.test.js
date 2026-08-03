/**
 * lib/sports/tennis/livePronostic.js — moteur simplifié pour Live Tennis API (plan
 * gratuit) : 4 lignes (vainqueur du match, vainqueur du set en cours, total de jeux,
 * total de sets), calculées à partir du classement (quand connu) et du score en
 * direct — jamais de profil de service/retour réel (indisponible sur ce plan).
 */
import { buildModelState, computeLivePronostic, deriveLiveSetsState, buildTennisSelectionCandidates } from "../lib/sports/tennis/livePronostic";

test("buildModelState : classement inconnu pour les deux joueurs -> base neutre (50/50 avant tout score)", () => {
  const modelState = buildModelState({ bestOf: 3 });
  const result = computeLivePronostic({ modelState, liveState: null });
  expect(result.probabilities.home).toBeCloseTo(50, 0);
  expect(result.probabilities.away).toBeCloseTo(50, 0);
});

test("buildModelState : un net avantage de classement favorise nettement le mieux classé", () => {
  const modelState = buildModelState({ homeRanking: 3, awayRanking: 250, bestOf: 3 });
  const result = computeLivePronostic({ modelState, liveState: null });
  expect(result.probabilities.home).toBeGreaterThan(65);
  expect(result.probabilities.away).toBeLessThan(35);
});

test("chaque match a ses propres valeurs : deux paires de classements différentes donnent des probabilités différentes", () => {
  const a = computeLivePronostic({ modelState: buildModelState({ homeRanking: 5, awayRanking: 40, bestOf: 3 }), liveState: null });
  const b = computeLivePronostic({ modelState: buildModelState({ homeRanking: 80, awayRanking: 90, bestOf: 3 }), liveState: null });
  expect(a.probabilities.home).not.toBe(b.probabilities.home);
});

test("total de jeux et total de sets sont au format Plus/Moins X,5, jamais un entier nu", () => {
  const modelState = buildModelState({ homeRanking: 10, awayRanking: 20, bestOf: 3 });
  const result = computeLivePronostic({ modelState, liveState: null });
  expect(result.gameTotals.line % 1).toBe(0.5);
  expect(["Plus", "Moins"]).toContain(result.gameTotals.side);
  expect(result.totalSets.line % 1).toBe(0.5);
  expect(["Plus", "Moins"]).toContain(result.totalSets.side);
});

test("bestOf=5 donne une ligne de total de sets plus haute (3,5) que bestOf=3 (2,5)", () => {
  const r3 = computeLivePronostic({ modelState: buildModelState({ bestOf: 3 }), liveState: null });
  const r5 = computeLivePronostic({ modelState: buildModelState({ bestOf: 5 }), liveState: null });
  expect(r3.totalSets.line).toBe(2.5);
  expect(r5.totalSets.line).toBe(3.5);
});

test("recalcul EN DIRECT : un joueur menant largement au score voit sa probabilité de victoire monter nettement", () => {
  const modelState = buildModelState({ bestOf: 3 }); // neutre au départ (50/50)
  const liveState = { setsWonHome: 1, setsWonAway: 0, currentSetGamesHome: 5, currentSetGamesAway: 1, gamesPlayedHome: 11, gamesPlayedAway: 3 };
  const result = computeLivePronostic({ modelState, liveState });
  expect(result.probabilities.home).toBeGreaterThan(70);
});

test("vainqueur du set en cours : reflète l'avantage réel dans CE set (jeux gagnés jusqu'ici)", () => {
  const modelState = buildModelState({ bestOf: 3 });
  const liveState = { setsWonHome: 0, setsWonAway: 0, currentSetGamesHome: 5, currentSetGamesAway: 0, gamesPlayedHome: 5, gamesPlayedAway: 0 };
  const result = computeLivePronostic({ modelState, liveState });
  expect(result.currentSetProbabilities.home).toBeGreaterThan(80);
});

describe("deriveLiveSetsState — dérive l'état à partir du vrai score par set (mapper)", () => {
  test("un set terminé 6-3 compte pour le vainqueur, le set en cours (3-2) reste 'en cours'", () => {
    const state = deriveLiveSetsState([{ home: 6, away: 3 }, { home: 3, away: 2 }]);
    expect(state.setsWonHome).toBe(1);
    expect(state.setsWonAway).toBe(0);
    expect(state.currentSetGamesHome).toBe(3);
    expect(state.currentSetGamesAway).toBe(2);
    expect(state.gamesPlayedHome).toBe(9);
    expect(state.gamesPlayedAway).toBe(5);
  });

  test("un jeu décisif gagné 7-6 compte comme un set complet, pas 'en cours'", () => {
    const state = deriveLiveSetsState([{ home: 7, away: 6 }]);
    expect(state.setsWonHome).toBe(1);
    expect(state.currentSetGamesHome).toBe(0);
    expect(state.currentSetGamesAway).toBe(0);
  });

  test("aucun set encore joué : tout à zéro, jamais une exception", () => {
    expect(deriveLiveSetsState([])).toEqual({
      setsWonHome: 0, setsWonAway: 0, currentSetGamesHome: 0, currentSetGamesAway: 0, gamesPlayedHome: 0, gamesPlayedAway: 0,
    });
    expect(deriveLiveSetsState(null)).toEqual({
      setsWonHome: 0, setsWonAway: 0, currentSetGamesHome: 0, currentSetGamesAway: 0, gamesPlayedHome: 0, gamesPlayedAway: 0,
    });
  });
});

describe("buildTennisSelectionCandidates — pool pour Combiné Vision (jamais d'aces, indisponibles sur ce plan)", () => {
  test("propose l'issue du match, le total de jeux et le total de sets — jamais un marché aces", () => {
    const modelState = buildModelState({ homeRanking: 5, awayRanking: 50, bestOf: 3 });
    const overlay = computeLivePronostic({ modelState, liveState: null });
    const candidates = buildTennisSelectionCandidates({
      probabilities: overlay.probabilities, homeTeamName: "Home", awayTeamName: "Away",
      gameTotals: overlay.gameTotals, totalSets: overlay.totalSets,
    });
    const labels = candidates.map((c) => c.marketLabel);
    expect(labels).toContain("Issue du match");
    expect(labels).toContain("Total jeux");
    expect(labels).toContain("Total sets");
    expect(labels.some((l) => /aces/i.test(l))).toBe(false);
  });

  test("le pick 'Issue du match' pointe toujours vers le joueur réellement favori", () => {
    const modelState = buildModelState({ homeRanking: 3, awayRanking: 300, bestOf: 3 });
    const overlay = computeLivePronostic({ modelState, liveState: null });
    const candidates = buildTennisSelectionCandidates({
      probabilities: overlay.probabilities, homeTeamName: "Home", awayTeamName: "Away",
      gameTotals: overlay.gameTotals, totalSets: overlay.totalSets,
    });
    const winner = candidates.find((c) => c.marketLabel === "Issue du match");
    expect(winner.verify).toEqual({ type: "winner", key: "home" });
  });
});
