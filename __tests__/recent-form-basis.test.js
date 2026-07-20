/**
 * Base de calcul des pronostics : la performance RÉCENTE et RÉELLE de chaque club
 * (ses derniers matchs joués), pas une moyenne de saison — deux équipes proches au
 * classement peuvent avoir des moyennes de saison presque identiques tout en
 * traversant des moments très différents (une en pleine forme, l'autre en crise),
 * et seuls les derniers matchs le montrent. Chaque équipe est calculée séparément à
 * partir de SES PROPRES matchs, jamais mélangés avec ceux de l'adversaire.
 */
const TOKEN = "test-token";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function recentMatchesFor(teamId, resultPattern) {
  // resultPattern : ex "WWWWW" ou "LLLLL", du plus ancien au plus récent.
  return [...resultPattern].map((letter, i) => {
    const gf = letter === "W" ? 3 : letter === "D" ? 1 : 0;
    const ga = letter === "W" ? 0 : letter === "D" ? 1 : 3;
    return {
      utcDate: new Date(Date.now() - (resultPattern.length - i) * 86400000).toISOString(),
      homeTeam: { id: teamId }, awayTeam: { id: 999 },
      score: { fullTime: { home: gf, away: ga } },
    };
  });
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = TOKEN;
});

test("deux équipes de milieu de tableau aux stats de saison quasi identiques mais en forme opposée ont des pronostics nettement différents", async () => {
  // Stats de saison volontairement très proches (30 buts/22 matchs vs 29/22) : sur le
  // seul classement, ces deux équipes seraient quasiment interchangeables.
  const table = [
    { position: 9, points: 34, form: null, playedGames: 22, goalsFor: 30, goalsAgainst: 29, team: { id: 3 } },
    { position: 10, points: 33, form: null, playedGames: 22, goalsFor: 29, goalsAgainst: 30, team: { id: 4 } },
  ];

  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table }] }) });
    }
    if (url.includes("head2head")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
    }
    if (url.includes("/teams/3/matches")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: recentMatchesFor(3, "WWWWW") }) });
    }
    if (url.includes("/teams/4/matches")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: recentMatchesFor(4, "LLLLL") }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "PL", homeTeamId: "3", awayTeamId: "4", homeTeamName: "MidTableA", awayTeamName: "MidTableB" } },
    res
  );

  // La forme récente réelle, pas le classement, sert de base au calcul.
  expect(res.body.home.source).toBe("forme récente");
  expect(res.body.away.source).toBe("forme récente");
  expect(res.body.home.form).toBe("WWWWW");
  expect(res.body.away.form).toBe("LLLLL");

  // Deux équipes "presque identiques" au classement, mais en forme opposée, ne
  // doivent PAS donner un pronostic proche de l'équilibre.
  expect(res.body.probabilities.home).toBeGreaterThan(80);
  expect(res.body.note).toMatch(/MidTableA .*favori/);

  // Le contexte du classement (position/points) reste affiché malgré tout.
  expect(res.body.home.position).toBe(9);
  expect(res.body.away.position).toBe(10);
});

test("les stats de chaque équipe viennent bien de SES PROPRES matchs — jamais mélangées avec celles de l'adversaire", async () => {
  const table = [
    { position: 5, points: 40, form: null, playedGames: 20, goalsFor: 28, goalsAgainst: 20, team: { id: 5 } },
    { position: 6, points: 39, form: null, playedGames: 20, goalsFor: 27, goalsAgainst: 21, team: { id: 6 } },
  ];

  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table }] }) });
    }
    if (url.includes("head2head")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
    }
    // Équipe 5 : très offensive récemment (4 buts marqués/match, aucun encaissé).
    if (url.includes("/teams/5/matches")) {
      const matches = Array.from({ length: 5 }, (_, i) => ({
        utcDate: new Date(Date.now() - i * 86400000).toISOString(),
        homeTeam: { id: 5 }, awayTeam: { id: 999 },
        score: { fullTime: { home: 4, away: 0 } },
      }));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches }) });
    }
    // Équipe 6 : très défensive récemment (aucun but marqué, aucun encaissé non plus).
    if (url.includes("/teams/6/matches")) {
      const matches = Array.from({ length: 5 }, (_, i) => ({
        utcDate: new Date(Date.now() - i * 86400000).toISOString(),
        homeTeam: { id: 6 }, awayTeam: { id: 999 },
        score: { fullTime: { home: 0, away: 0 } },
      }));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "PL", homeTeamId: "5", awayTeamId: "6", homeTeamName: "Offensive", awayTeamName: "Defensive" } },
    res
  );

  // Buts attendus très différents entre les deux équipes : la valeur de chacune
  // reflète SES propres matchs récents, pas une moyenne des deux ou une confusion.
  expect(res.body.goals.expectedHome).toBeGreaterThanOrEqual(2); // équipe 5 : 4 buts/match récemment, tous à domicile (vrai profil domicile utilisé directement)
  expect(res.body.goals.expectedAway).toBeLessThan(1.2); // équipe 6 : 0 but/match récemment
  expect(res.body.goals.expectedHome).toBeGreaterThan(res.body.goals.expectedAway * 2);
});

test("sans forme récente disponible, le classement sert bien de repli (comportement inchangé)", async () => {
  const table = [
    { position: 1, points: 60, form: "WWDLW", playedGames: 20, goalsFor: 50, goalsAgainst: 15, team: { id: 7 } },
  ];

  global.fetch = jest.fn((url) => {
    if (url.includes("/standings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table }] }) });
    }
    if (url.includes("head2head")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ aggregates: { numberOfMatches: 0 } }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`)); // pas de derniers matchs disponibles
  });

  const { default: handler } = await import("../pages/api/analyze.js");
  const res = mockRes();
  await handler(
    { query: { competitionCode: "PL", homeTeamId: "7", awayTeamId: "8", homeTeamName: "A", awayTeamName: "B" } },
    res
  );

  expect(res.body.home.source).toBe("classement");
  expect(res.body.home.form).toBe("WWDLW");
  expect(res.body.away.source).toBe("estimation moyenne");
});
