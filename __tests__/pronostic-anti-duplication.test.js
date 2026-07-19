/**
 * PROMPT 5 (l'étape la plus importante) : chaque match doit avoir SES PROPRES
 * pronostics, calculés à partir des données réelles de CE match précis (classement/
 * forme récente + confrontations directes via l'API — voir lib/pronostic.js et
 * lib/headToHead.js). Deux matchs différents ne doivent jamais afficher les mêmes
 * chiffres, et aucune valeur ne doit être codée en dur : changer les données d'entrée
 * doit changer le résultat.
 */
const TOKEN = "test-token";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

// Simule /competitions/{code}/standings, /matches/{id} (état du match) et
// /matches/{id}/head2head pour un jeu de données réaliste et distinct par match.
function mockFetchFor({ table, matchState, h2h }) {
  return jest.fn((url) => {
    if (url.includes("head2head")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: h2h || { numberOfMatches: 0 } }) });
    }
    if (url.includes("/standings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table }] }) });
    }
    if (url.match(/\/matches\/\d+$/)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(matchState) });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

function scheduledState() {
  return { status: "SCHEDULED", minute: null, score: { fullTime: { home: null, away: null } } };
}

async function analyze(query, mock) {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
  global.fetch = mock;
  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler({ query }, res);
  return res.body;
}

// Trois profils d'équipes bien distincts (classement/forme réels différents), comme
// trois vrais matchs pourraient l'être un soir de championnat.
const MATCH_1 = {
  table: [
    { position: 2, points: 60, form: "WWWDW", playedGames: 22, goalsFor: 55, goalsAgainst: 15, team: { id: 10 } }, // Arsenal
    { position: 18, points: 20, form: "LLDLL", playedGames: 22, goalsFor: 18, goalsAgainst: 50, team: { id: 11 } }, // Fulham
  ],
  homeTeamId: "10", awayTeamId: "11", homeTeamName: "Arsenal FC", awayTeamName: "Fulham FC", competitionCode: "PL", matchId: "101",
};
const MATCH_2 = {
  table: [
    { position: 1, points: 68, form: "WWWWW", playedGames: 24, goalsFor: 62, goalsAgainst: 18, team: { id: 20 } }, // Real Madrid
    { position: 2, points: 64, form: "WWDWW", playedGames: 24, goalsFor: 58, goalsAgainst: 20, team: { id: 21 } }, // Barcelona
  ],
  homeTeamId: "20", awayTeamId: "21", homeTeamName: "Real Madrid", awayTeamName: "Barcelona", competitionCode: "PD", matchId: "102",
};
const MATCH_3 = {
  table: [
    { position: 5, points: 38, form: "DDDLD", playedGames: 22, goalsFor: 20, goalsAgainst: 18, team: { id: 30 } }, // Juventus (défensif)
    { position: 15, points: 22, form: "LDLLD", playedGames: 22, goalsFor: 16, goalsAgainst: 30, team: { id: 31 } }, // Salernitana
  ],
  homeTeamId: "30", awayTeamId: "31", homeTeamName: "Juventus FC", awayTeamName: "Salernitana", competitionCode: "SA", matchId: "103",
};

async function analyzeMatch(m) {
  const mock = mockFetchFor({ table: m.table, matchState: scheduledState() });
  return analyze(
    {
      matchId: m.matchId, competitionCode: m.competitionCode,
      homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId,
      homeTeamName: m.homeTeamName, awayTeamName: m.awayTeamName,
    },
    mock
  );
}

describe("Anti-duplication : 3 matchs différents ont 3 pronostics différents", () => {
  test("les probabilités 1X2, les buts probables et les scores exacts ne sont JAMAIS identiques entre deux matchs différents", async () => {
    const r1 = await analyzeMatch(MATCH_1);
    const r2 = await analyzeMatch(MATCH_2);
    const r3 = await analyzeMatch(MATCH_3);

    const fingerprint = (r) => JSON.stringify({
      probabilities: r.probabilities,
      goals: r.goals.expectedTotal,
      correctScores: r.correctScores.map((s) => s.score),
    });

    const f1 = fingerprint(r1);
    const f2 = fingerprint(r2);
    const f3 = fingerprint(r3);

    expect(f1).not.toBe(f2);
    expect(f1).not.toBe(f3);
    expect(f2).not.toBe(f3);
  });

  test("chaque match affiche bien tous les champs demandés, calculés pour lui, avec 100% de probabilité totale", async () => {
    for (const m of [MATCH_1, MATCH_2, MATCH_3]) {
      const r = await analyzeMatch(m);

      expect(r.available).toBe(true);
      // Les trois probabilités sont renormalisées pour sommer à exactement 100 %
      // (voir normalizeProbabilitiesToHundred dans lib/pronostic.js).
      const total = r.probabilities.home + r.probabilities.draw + r.probabilities.away;
      expect(Math.round(total * 10) / 10).toBe(100);

      expect(typeof r.goals.expectedTotal).toBe("number");
      expect(r.correctScores.length).toBeGreaterThanOrEqual(3);
      // Du plus probable au moins probable.
      for (let i = 1; i < r.correctScores.length; i++) {
        expect(r.correctScores[i - 1].probability).toBeGreaterThanOrEqual(r.correctScores[i].probability);
      }

      expect(r.extraStats.corners.total).toBeGreaterThan(0);
      expect(r.extraStats.shots.total).toBeGreaterThan(0);
      expect(r.extraStats.cards.total).toBeGreaterThan(0);
      expect(r.extraStats.possession.home + r.extraStats.possession.away).toBe(100);
    }
  });

  test("les extraStats (corners/tirs/cartons/possession) diffèrent aussi selon le match — pas une valeur fixe recopiée partout", async () => {
    const r1 = await analyzeMatch(MATCH_1);
    const r2 = await analyzeMatch(MATCH_2);
    const r3 = await analyzeMatch(MATCH_3);

    const stats = [r1, r2, r3].map((r) => JSON.stringify(r.extraStats));
    expect(new Set(stats).size).toBe(3);
  });

  // Régression : le TOTAL de corners/tirs/cartons était calé sur une moyenne de
  // championnat fixe, seule la répartition domicile/extérieur variait — deux matchs
  // d'intensité très différente (une démonstration offensive vs un match fermé)
  // affichaient donc presque le même total de tirs à l'écran. Vérifie que le total
  // suit bien le nombre de buts attendu de CE match, pas une constante déguisée.
  test("le TOTAL de tirs (affiché à l'écran) est bien plus élevé pour un match très offensif que pour un match fermé, pas une moyenne fixe", async () => {
    const openGame = { position: 1, points: 60, form: null, playedGames: 20, goalsFor: 62, goalsAgainst: 18, team: { id: 70 } };
    const openGame2 = { position: 2, points: 58, form: null, playedGames: 20, goalsFor: 58, goalsAgainst: 20, team: { id: 71 } };
    const closedGame = { position: 10, points: 30, form: null, playedGames: 20, goalsFor: 18, goalsAgainst: 16, team: { id: 72 } };
    const closedGame2 = { position: 11, points: 28, form: null, playedGames: 20, goalsFor: 16, goalsAgainst: 18, team: { id: 73 } };

    const open = await analyze(
      { matchId: "501", competitionCode: "PL", homeTeamId: "70", awayTeamId: "71", homeTeamName: "Offensif A", awayTeamName: "Offensif B" },
      mockFetchFor({ table: [openGame, openGame2], matchState: scheduledState() })
    );
    const closed = await analyze(
      { matchId: "502", competitionCode: "PL", homeTeamId: "72", awayTeamId: "73", homeTeamName: "Fermé A", awayTeamName: "Fermé B" },
      mockFetchFor({ table: [closedGame, closedGame2], matchState: scheduledState() })
    );

    expect(open.extraStats.shots.total).toBeGreaterThan(closed.extraStats.shots.total + 5);
    expect(open.extraStats.corners.total).toBeGreaterThan(closed.extraStats.corners.total);
    expect(open.extraStats.shots.total).not.toBe(closed.extraStats.shots.total);
  });
});

describe("Aucune valeur codée en dur : le résultat suit vraiment les données d'entrée de CE match", () => {
  test("changer uniquement l'équipe à domicile (l'extérieur restant identique) change le pronostic", async () => {
    const away = { position: 10, points: 35, form: "DLWDL", playedGames: 20, goalsFor: 25, goalsAgainst: 28, team: { id: 99 } };
    const strongHome = { position: 1, points: 70, form: "WWWWW", playedGames: 20, goalsFor: 55, goalsAgainst: 10, team: { id: 1 } };
    const weakHome = { position: 19, points: 15, form: "LLLLL", playedGames: 20, goalsFor: 12, goalsAgainst: 48, team: { id: 2 } };

    const strong = await analyze(
      { matchId: "201", competitionCode: "PL", homeTeamId: "1", awayTeamId: "99", homeTeamName: "Fort", awayTeamName: "Moyen" },
      mockFetchFor({ table: [strongHome, away], matchState: scheduledState() })
    );
    const weak = await analyze(
      { matchId: "202", competitionCode: "PL", homeTeamId: "2", awayTeamId: "99", homeTeamName: "Faible", awayTeamName: "Moyen" },
      mockFetchFor({ table: [weakHome, away], matchState: scheduledState() })
    );

    expect(strong.probabilities.home).not.toBeCloseTo(weak.probabilities.home, 0);
    expect(strong.probabilities.home).toBeGreaterThan(weak.probabilities.home);
    expect(strong.goals.expectedTotal).not.toBe(weak.goals.expectedTotal);
    expect(strong.correctScores.map((s) => s.score)).not.toEqual(weak.correctScores.map((s) => s.score));
  });

  test("changer uniquement l'équipe à l'extérieur (le domicile restant identique) change le pronostic", async () => {
    const home = { position: 8, points: 36, form: "WDLWD", playedGames: 20, goalsFor: 28, goalsAgainst: 24, team: { id: 50 } };
    const strongAway = { position: 1, points: 70, form: "WWWWW", playedGames: 20, goalsFor: 55, goalsAgainst: 10, team: { id: 51 } };
    const weakAway = { position: 19, points: 15, form: "LLLLL", playedGames: 20, goalsFor: 12, goalsAgainst: 48, team: { id: 52 } };

    const vsStrong = await analyze(
      { matchId: "301", competitionCode: "PL", homeTeamId: "50", awayTeamId: "51", homeTeamName: "Moyen", awayTeamName: "Fort" },
      mockFetchFor({ table: [home, strongAway], matchState: scheduledState() })
    );
    const vsWeak = await analyze(
      { matchId: "302", competitionCode: "PL", homeTeamId: "50", awayTeamId: "52", homeTeamName: "Moyen", awayTeamName: "Faible" },
      mockFetchFor({ table: [home, weakAway], matchState: scheduledState() })
    );

    expect(vsStrong.probabilities.away).not.toBeCloseTo(vsWeak.probabilities.away, 0);
    expect(vsStrong.probabilities.away).toBeGreaterThan(vsWeak.probabilities.away);
    expect(vsStrong.goals.expectedTotal).not.toBe(vsWeak.goals.expectedTotal);
  });

  test("les vraies confrontations directes (API head2head) influencent le résultat quand il y en a assez — jamais une valeur ignorée en silence", async () => {
    const home = { position: 6, points: 38, form: "WDWDL", playedGames: 20, goalsFor: 30, goalsAgainst: 24, team: { id: 60 } };
    const away = { position: 6, points: 38, form: "WDWDL", playedGames: 20, goalsFor: 30, goalsAgainst: 24, team: { id: 61 } };

    const withoutHistory = await analyze(
      { matchId: "401", competitionCode: "PL", homeTeamId: "60", awayTeamId: "61", homeTeamName: "A", awayTeamName: "B" },
      mockFetchFor({ table: [home, away], matchState: scheduledState(), h2h: { numberOfMatches: 0 } })
    );
    // Historique très favorable au domicile sur les confrontations directes récentes.
    const withHistory = await analyze(
      { matchId: "402", competitionCode: "PL", homeTeamId: "60", awayTeamId: "61", homeTeamName: "A", awayTeamName: "B" },
      mockFetchFor({
        table: [home, away], matchState: scheduledState(),
        h2h: { numberOfMatches: 5, totalGoals: 20, homeTeam: { wins: 5, draws: 0 }, awayTeam: { wins: 0 } },
      })
    );

    expect(withHistory.h2hUsed).toBe(true);
    expect(withoutHistory.h2hUsed).toBe(false);
    expect(withHistory.probabilities.home).toBeGreaterThan(withoutHistory.probabilities.home);
  });
});
