/**
 * lib/sports/tennis/pronosticModel.js — bloc 7 : les 11 blocs demandés, calculés à
 * partir de deux profils de joueur réels et différents (jamais les mêmes valeurs
 * recopiées d'un match à l'autre), avec la règle figé/live (probabilité de victoire,
 * scores en sets, totaux de jeux évoluent en direct ; aces/doubles fautes/breaks/
 * tie-break/handicap restent figés).
 */
const { computeTennisPronostic, computeTennisLiveOverlay } = require("../lib/sports/tennis/pronosticModel");

function field(value, overrides = {}) {
  return value == null
    ? { value: null, estimated: true, sampleSize: 0, available: false }
    : { value, estimated: false, sampleSize: 8, available: true, ...overrides };
}

function profile(overrides = {}) {
  return {
    available: true,
    playerName: "Joueur",
    ranking: 12,
    form: "WWLWW",
    matchesUsed: 8,
    matchesRecent14d: 2,
    serveWinPct: field(64),
    returnWinPct: field(38),
    firstServeInPct: field(61),
    firstServeWonPct: field(70),
    secondServeWonPct: field(48),
    acesPerMatch: field(7),
    doubleFaultsPerMatch: field(2.5),
    breakPointsWonPct: field(42),
    ...overrides,
  };
}

test("les deux profils indisponibles : pronostic indisponible, jamais une erreur qui casse la page", () => {
  const result = computeTennisPronostic({ homeProfile: { available: false }, awayProfile: { available: false } });
  expect(result.available).toBe(false);
  expect(result.reason).toBeTruthy();
});

test("deux profils disponibles : pronostic complet, toujours disponible même si les deux joueurs sont proches", () => {
  const result = computeTennisPronostic({
    homeProfile: profile(), awayProfile: profile(), homeTeamName: "Joueur A", awayTeamName: "Joueur B", surface: "Dur",
  });
  expect(result.available).toBe(true);
  expect(result.probabilities.home + result.probabilities.away).toBeCloseTo(100, 0);
});

test("Bloc 1 — probabilité de victoire : le joueur au profil nettement meilleur est favori, avec une justification non vide", () => {
  const strong = profile({ serveWinPct: field(72), returnWinPct: field(45), ranking: 3 });
  const weak = profile({ serveWinPct: field(55), returnWinPct: field(30), ranking: 80 });
  const result = computeTennisPronostic({ homeProfile: strong, awayProfile: weak, homeTeamName: "Fort", awayTeamName: "Faible" });
  expect(result.probabilities.home).toBeGreaterThan(result.probabilities.away);
  expect(result.narrative.winProbability).toMatch(/Fort/);
  expect(result.narrative.winProbability.length).toBeGreaterThan(20);
});

test("Bloc 1 — pourcentages réservés à la probabilité de victoire uniquement (aucun autre bloc ne contient de '%')", () => {
  const result = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
  const serialized = JSON.stringify({ ...result, probabilities: undefined, narrative: undefined, serviceReturnContext: undefined });
  expect(serialized).not.toMatch(/%/);
});

test("Bloc 2 — entre 3 et 4 scores en sets probables, meilleur des 3 par défaut (2 sets gagnants)", () => {
  const result = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
  expect(result.setScores.length).toBeGreaterThanOrEqual(3);
  expect(result.setScores.length).toBeLessThanOrEqual(4);
  for (const s of result.setScores) {
    const [a, b] = s.score.split("-").map(Number);
    expect(Math.max(a, b)).toBe(2);
  }
});

test("Bloc 2 — Grand Chelem masculin (bestOf=5) : scores en sets jusqu'à 3 sets gagnants", () => {
  const result = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B", bestOf: 5 });
  for (const s of result.setScores) {
    const [a, b] = s.score.split("-").map(Number);
    expect(Math.max(a, b)).toBe(3);
  }
});

test("Bloc 3 — totaux de jeux au format Plus/Moins de X,5, jamais une cote", () => {
  const result = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
  expect(result.gameTotals.total.available).toBe(true);
  expect(result.gameTotals.total.lines[0].line % 1).toBe(0.5);
  expect(["Plus", "Moins"]).toContain(result.gameTotals.total.lines[0].side);
});

test("Bloc 4 — handicap jeux : une option sûre et une option plus risquée, en faveur du favori", () => {
  const strong = profile({ serveWinPct: field(75), returnWinPct: field(48) });
  const weak = profile({ serveWinPct: field(55), returnWinPct: field(25) });
  const result = computeTennisPronostic({ homeProfile: strong, awayProfile: weak, homeTeamName: "A", awayTeamName: "B" });
  expect(result.gameHandicap.favorite).toBe("home");
  expect(result.gameHandicap.safe.line % 1).toBe(0.5);
  expect(result.gameHandicap.risky.line % 1).toBe(0.5);
});

test("Bloc 5 — total de sets (2,5 en Bo3, 3,5 en Bo5), 'les deux gagnent un set' en Oui/Non, 1er set", () => {
  const bo3 = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
  expect(bo3.setsBlock.totalSets.line).toBe(2.5);
  expect(["Oui", "Non"]).toContain(bo3.setsBlock.bothWinASet);
  expect(["home", "away"]).toContain(bo3.setsBlock.firstSetWinner);
  expect(bo3.setsBlock.firstSetGames.available).toBe(true);

  const bo5 = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B", bestOf: 5 });
  expect(bo5.setsBlock.totalSets.line).toBe(3.5);
});

test("Blocs 6-7 — aces et doubles fautes : Total match + Total 1 + Total 2, dérivés des vraies moyennes de chaque joueur", () => {
  const result = computeTennisPronostic({
    homeProfile: profile({ acesPerMatch: field(10), doubleFaultsPerMatch: field(1) }),
    awayProfile: profile({ acesPerMatch: field(4), doubleFaultsPerMatch: field(4) }),
    homeTeamName: "A", awayTeamName: "B",
  });
  expect(result.aces.home.lines[0].line).toBeCloseTo(10.5, 5);
  expect(result.aces.away.lines[0].line).toBeCloseTo(4.5, 5);
  expect(result.doubleFaults.home.lines[0].line).toBeLessThan(result.doubleFaults.away.lines[0].line);
});

test("Bloc 8 — breaks dérivés du modèle (jamais 0 si des breaks sont statistiquement probables)", () => {
  const result = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
  expect(result.breaks.total.available).toBe(true);
  expect(result.breaks.total.lines[0].line).toBeGreaterThan(0);
});

test("Bloc 9 — jeu décisif : Oui/Non, jamais un pourcentage affiché", () => {
  const result = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
  expect(["Oui", "Non"]).toContain(result.tiebreak.likely);
});

test("Bloc 10 — contexte service/retour : les vrais chiffres de chaque joueur, jamais mélangés", () => {
  const result = computeTennisPronostic({
    homeProfile: profile({ firstServeInPct: field(70) }),
    awayProfile: profile({ firstServeInPct: field(55) }),
    homeTeamName: "A", awayTeamName: "B",
  });
  expect(result.serviceReturnContext.home.firstServeInPct).toBe(70);
  expect(result.serviceReturnContext.away.firstServeInPct).toBe(55);
});

test("Bloc 11 — scénario du match : au moins 2 phrases", () => {
  const result = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B", surface: "Terre battue" });
  const sentenceCount = result.narrative.matchScenario.split(/[.!]\s/).filter(Boolean).length;
  expect(sentenceCount).toBeGreaterThanOrEqual(2);
});

test("chaque match a des pronostics INDIVIDUELS : deux paires de profils différentes ne donnent jamais les mêmes valeurs", () => {
  const matchA = computeTennisPronostic({
    homeProfile: profile({ serveWinPct: field(70) }), awayProfile: profile({ serveWinPct: field(50) }),
    homeTeamName: "A1", awayTeamName: "A2",
  });
  const matchB = computeTennisPronostic({
    homeProfile: profile({ serveWinPct: field(60) }), awayProfile: profile({ serveWinPct: field(58) }),
    homeTeamName: "B1", awayTeamName: "B2",
  });
  expect(matchA.probabilities).not.toEqual(matchB.probabilities);
  expect(matchA.gameTotals).not.toEqual(matchB.gameTotals);
});

test("H2H réel : un historique direct net en faveur d'un joueur nudge la probabilité vers lui", () => {
  const h2hGames = [
    { status: { short: "FT" }, teams: { home: { id: 1 } }, scores: { home: { set_1: 6, set_2: 6 }, away: { set_1: 3, set_2: 2 } } },
    { status: { short: "FT" }, teams: { home: { id: 1 } }, scores: { home: { set_1: 6, set_2: 6 }, away: { set_1: 4, set_2: 3 } } },
  ];
  const withoutH2H = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B", homeId: 1 });
  const withH2H = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B", homeId: 1, h2hGames });
  expect(withH2H.h2hUsed).toBe(true);
  expect(withH2H.probabilities.home).toBeGreaterThan(withoutH2H.probabilities.home);
});

describe("Règle figé/live — computeTennisLiveOverlay", () => {
  test("avant le match (pas de liveState) : identique au calcul figé", () => {
    const frozen = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
    const overlay = computeTennisLiveOverlay({ modelState: frozen.modelState, bestOf: 3, liveState: null });
    expect(overlay.probabilities).toEqual(frozen.probabilities);
  });

  test("joueur 1 mène déjà 1 set à 0 : sa probabilité de victoire augmente par rapport au calcul figé", () => {
    const frozen = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
    const overlay = computeTennisLiveOverlay({
      modelState: frozen.modelState, bestOf: 3,
      liveState: { setsWonHome: 1, setsWonAway: 0, currentSetGamesHome: 0, currentSetGamesAway: 0, gamesPlayedHome: 6, gamesPlayedAway: 3 },
    });
    expect(overlay.probabilities.home).toBeGreaterThan(frozen.probabilities.home);
  });

  test("totaux de jeux en direct incluent bien les jeux déjà joués (jamais repartis de zéro)", () => {
    const frozen = computeTennisPronostic({ homeProfile: profile(), awayProfile: profile(), homeTeamName: "A", awayTeamName: "B" });
    const overlay = computeTennisLiveOverlay({
      modelState: frozen.modelState, bestOf: 3,
      liveState: { setsWonHome: 1, setsWonAway: 1, currentSetGamesHome: 2, currentSetGamesAway: 1, gamesPlayedHome: 14, gamesPlayedAway: 12 },
    });
    expect(overlay.gameTotals.total.lines[0].line).toBeGreaterThan(26); // au moins les 26 jeux déjà joués (14+12)
  });

  test("aces/doubles fautes/breaks/tie-break/handicap ne sont PAS recalculés par l'overlay (restent figés côté appelant)", () => {
    const overlay = computeTennisLiveOverlay({
      modelState: { p1Hold: 0.65, p2Hold: 0.6, p1PointOnServe: 0.63, p2PointOnServe: 0.6, pSet: 0.55 },
      bestOf: 3, liveState: { setsWonHome: 1, setsWonAway: 0, currentSetGamesHome: 3, currentSetGamesAway: 2, gamesPlayedHome: 6, gamesPlayedAway: 3 },
    });
    expect(overlay.aces).toBeUndefined();
    expect(overlay.breaks).toBeUndefined();
    expect(overlay.tiebreak).toBeUndefined();
    expect(overlay.gameHandicap).toBeUndefined();
  });
});
