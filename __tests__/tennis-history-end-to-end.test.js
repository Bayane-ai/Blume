/**
 * Vérification bout en bout (bloc 8 : "Vérifie toi-même que les sections
 * 'Probabilités réussies' et 'Probabilités échouées' du tennis se remplissent
 * réellement après la fin d'un match, et corrige si ce n'est pas le cas") — simule une
 * vraie base Supabase en mémoire (comme __tests__/basketball-history-end-to-end.test.js)
 * pour prouver que le chemin COMPLET fonctionne réellement :
 *   1) pages/api/tennis/analyze.js analyse un match tennis déjà terminé pour la
 *      première fois -> fige ET classe le pronostic (Succès/Échec, sur la seule
 *      probabilité de victoire) -> écrit une vraie ligne dans "pronostic_history"
 *      (sport='tennis').
 *   2) pages/api/pronostic-history.js?sport=tennis&status=... relit cette ligne.
 * Aucune étape n'est mockée entre ces deux maillons : seule la base Supabase elle-même
 * est remplacée par une implémentation en mémoire avec la VRAIE logique de filtrage.
 */
function makeFakeSupabase() {
  const db = { pronostic_history: [] };

  function rowMatches(row, filters) {
    return filters.every((f) => {
      if (f.op === "eq") return row[f.col] === f.val;
      if (f.op === "not_is_null") return row[f.col] != null;
      if (f.op === "is_null") return row[f.col] == null;
      if (f.op === "lt") return row[f.col] != null && row[f.col] < f.val;
      return true;
    });
  }

  function builder(table) {
    const state = { filters: [] };
    const api = {
      select() { return api; },
      eq(col, val) { state.filters.push({ op: "eq", col, val }); return api; },
      not(col, op2, val) { state.filters.push({ op: op2 === "is" && val === null ? "not_is_null" : "eq", col, val }); return api; },
      is(col, val) { state.filters.push({ op: val === null ? "is_null" : "eq", col, val }); return api; },
      lt(col, val) { state.filters.push({ op: "lt", col, val }); return api; },
      order(col, opts) { state.orderCol = col; state.orderAsc = opts?.ascending !== false; return api; },
      limit(n) { state.limitN = n; return api; },
      maybeSingle() {
        const rows = db[table].filter((r) => rowMatches(r, state.filters));
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      update(patch) { state.updatePatch = patch; return api; },
      delete() { state.isDelete = true; return api; },
      then(resolve) {
        if (state.updatePatch) {
          db[table] = db[table].map((r) => (rowMatches(r, state.filters) ? { ...r, ...state.updatePatch } : r));
          return Promise.resolve({ error: null }).then(resolve);
        }
        if (state.isDelete) {
          db[table] = db[table].filter((r) => !rowMatches(r, state.filters));
          return Promise.resolve({ error: null }).then(resolve);
        }
        let rows = db[table].filter((r) => rowMatches(r, state.filters));
        if (state.orderCol) {
          rows = [...rows].sort((a, b) => {
            const av = a[state.orderCol];
            const bv = b[state.orderCol];
            if (av === bv) return 0;
            const cmp = av > bv ? 1 : -1;
            return state.orderAsc ? cmp : -cmp;
          });
        }
        if (state.limitN != null) rows = rows.slice(0, state.limitN);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return api;
  }

  return {
    db,
    from(table) {
      const b = builder(table);
      b.upsert = (row, opts) => ({
        then(resolve) {
          const existing = db[table].find((r) => r.match_id === row.match_id);
          if (existing) {
            if (!opts?.ignoreDuplicates) Object.assign(existing, row);
          } else {
            db[table].push({ ...row });
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      });
      return b;
    },
  };
}

jest.mock("../lib/supabaseAnon", () => ({ supabaseAnon: { from: jest.fn() } }));

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function field(value) {
  return { value, estimated: value == null, sampleSize: 8, available: value != null };
}

// Djokovic nettement plus fort qu'Alcaraz sur cette surface -> favori clairement
// désigné (probabilité de victoire domicile largement > 50%), pour un test déterministe.
function strongHomeProfile() {
  return {
    available: true, playerName: "Djokovic", ranking: 1, form: "WWWWW", matchesUsed: 8,
    serveWinPct: field(72), returnWinPct: field(45), firstServeInPct: field(66),
    firstServeWonPct: field(80), secondServeWonPct: field(55),
    acesPerMatch: field(10), doubleFaultsPerMatch: field(1.5), breakPointsWonPct: field(47),
  };
}
function weakAwayProfile() {
  return {
    available: true, playerName: "Alcaraz", ranking: 80, form: "LLLWL", matchesUsed: 8,
    serveWinPct: field(55), returnWinPct: field(28), firstServeInPct: field(58),
    firstServeWonPct: field(65), secondServeWonPct: field(42),
    acesPerMatch: field(4), doubleFaultsPerMatch: field(4.5), breakPointsWonPct: field(30),
  };
}

function finishedGame({ homeSets, awaySets }) {
  const scoresHome = {};
  const scoresAway = {};
  homeSets.forEach((h, i) => { scoresHome[`set_${i + 1}`] = h; });
  awaySets.forEach((a, i) => { scoresAway[`set_${i + 1}`] = a; });
  return {
    // Date récente ("maintenant") plutôt qu'une date figée : le vrai nettoyage des
    // entrées de plus de 5 jours supprimerait sinon cette ligne de test.
    id: 555, date: new Date().toISOString(), status: { long: "Finished", short: "FT" },
    teams: { home: { id: 10, name: "Djokovic" }, away: { id: 11, name: "Alcaraz" } },
    scores: { home: scoresHome, away: scoresAway },
  };
}

beforeEach(() => {
  jest.resetModules();
});

async function setupModules({ fakeDb, gameObj, statsRows }) {
  const { supabaseAnon } = require("../lib/supabaseAnon");
  supabaseAnon.from = fakeDb.from;

  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => "test-key",
    getGameById: jest.fn(() => Promise.resolve(gameObj)),
    getGameStatistics: jest.fn(() => Promise.resolve(statsRows)),
    getHeadToHead: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({
    getOrBuildPlayerProfile: jest.fn(({ playerId }) =>
      Promise.resolve(String(playerId) === "10" ? strongHomeProfile() : weakAwayProfile())
    ),
  }));
  // lib/sports/tennis/pronosticHistory.js n'est PAS mocké : c'est le vrai code, contre
  // la fausse base ci-dessus — c'est exactement ce que ce test vérifie.
}

function djokovicWinsMatch() {
  return finishedGame({ homeSets: [6, 6, 6], awaySets: [4, 3, 2] }); // 3 sets à 0
}
function djokovicLosesMatch() {
  return finishedGame({ homeSets: [3, 2, 4, 1], awaySets: [6, 6, 6, 6] }); // 0 set à 4 (bo5 improbable mais suffisant pour le test)
}

test("un match tennis qui se termine avec le joueur favori vainqueur remplit réellement « Probabilités réussies »", async () => {
  const fakeDb = makeFakeSupabase();
  const game = djokovicWinsMatch();
  await setupModules({ fakeDb, gameObj: game, statsRows: [] });

  const { default: analyzeHandler } = await import("../pages/api/tennis/analyze.js");
  const analyzeRes = mockRes();
  await analyzeHandler(
    { query: { matchId: "tn-555", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "Djokovic", awayTeamName: "Alcaraz", surface: "Dur" } },
    analyzeRes
  );

  // 1) La réponse d'analyse elle-même confirme le succès immédiat.
  expect(analyzeRes.body.available).toBe(true);
  expect(analyzeRes.body.historyStatus).toBe("success");
  expect(analyzeRes.body.verification.winner).toBe(true);

  // 2) La vraie ligne existe bien dans "la base", avec sport='tennis'.
  expect(fakeDb.db.pronostic_history).toHaveLength(1);
  expect(fakeDb.db.pronostic_history[0]).toMatchObject({ match_id: "tn-555", sport: "tennis", status: "success" });

  // 3) La route qui alimente la page "Probabilités réussies" la retrouve réellement.
  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const successRes = mockRes();
  await historyHandler({ query: { status: "success", sport: "tennis" } }, successRes);
  expect(successRes.body.items).toHaveLength(1);
  expect(successRes.body.items[0].match_id).toBe("tn-555");
  expect(successRes.body.items[0].home_team_name).toBe("Djokovic");
  expect(successRes.body.items[0].final_score).toEqual({ home: 3, away: 0 });

  // Et « Probabilités échouées » reste vide pour ce match.
  const failureRes = mockRes();
  await historyHandler({ query: { status: "failure", sport: "tennis" } }, failureRes);
  expect(failureRes.body.items.find((i) => i.match_id === "tn-555")).toBeUndefined();
});

test("un match tennis qui se termine avec le joueur favori perdant remplit réellement « Probabilités échouées »", async () => {
  const fakeDb = makeFakeSupabase();
  const game = djokovicLosesMatch();
  await setupModules({ fakeDb, gameObj: game, statsRows: [] });

  const { default: analyzeHandler } = await import("../pages/api/tennis/analyze.js");
  const analyzeRes = mockRes();
  await analyzeHandler(
    { query: { matchId: "tn-555", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "Djokovic", awayTeamName: "Alcaraz", category: "Grand Slam" } },
    analyzeRes
  );

  expect(analyzeRes.body.historyStatus).toBe("failure");
  expect(analyzeRes.body.verification.winner).toBe(false);

  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const failureRes = mockRes();
  await historyHandler({ query: { status: "failure", sport: "tennis" } }, failureRes);
  expect(failureRes.body.items).toHaveLength(1);
  expect(failureRes.body.items[0].match_id).toBe("tn-555");

  const successRes = mockRes();
  await historyHandler({ query: { status: "success", sport: "tennis" } }, successRes);
  expect(successRes.body.items).toHaveLength(0);
});

test("un match tennis pas encore terminé n'apparaît dans AUCUNE des deux listes tant qu'il n'est pas classé", async () => {
  const fakeDb = makeFakeSupabase();
  const liveGame = { ...djokovicWinsMatch(), status: { long: "Set 2", short: "Set2" } };
  await setupModules({ fakeDb, gameObj: liveGame, statsRows: [] });

  const { default: analyzeHandler } = await import("../pages/api/tennis/analyze.js");
  const analyzeRes = mockRes();
  await analyzeHandler(
    { query: { matchId: "tn-555", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "Djokovic", awayTeamName: "Alcaraz" } },
    analyzeRes
  );
  expect(analyzeRes.body.historyStatus).toBeUndefined();
  expect(fakeDb.db.pronostic_history[0].status).toBe("pending");

  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const successRes = mockRes();
  await historyHandler({ query: { status: "success", sport: "tennis" } }, successRes);
  const failureRes = mockRes();
  await historyHandler({ query: { status: "failure", sport: "tennis" } }, failureRes);
  expect(successRes.body.items).toHaveLength(0);
  expect(failureRes.body.items).toHaveLength(0);
});

test("un pronostic tennis 'pending' devenu terminé entre-temps est classé automatiquement au chargement de la page (balayage)", async () => {
  const fakeDb = makeFakeSupabase();
  const liveGame = { ...djokovicWinsMatch(), status: { long: "Set 2", short: "Set2" } };
  await setupModules({ fakeDb, gameObj: liveGame, statsRows: [] });
  const { default: analyzeHandler } = await import("../pages/api/tennis/analyze.js");
  await analyzeHandler(
    { query: { matchId: "tn-555", homeTeamId: "tn-10", awayTeamId: "tn-11", homeTeamName: "Djokovic", awayTeamName: "Alcaraz" } },
    mockRes()
  );
  expect(fakeDb.db.pronostic_history[0].status).toBe("pending");

  jest.resetModules();
  const { supabaseAnon } = require("../lib/supabaseAnon");
  supabaseAnon.from = fakeDb.from;
  const finishedNow = djokovicWinsMatch();
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => "test-key",
    getGameById: jest.fn(() => Promise.resolve(finishedNow)),
    getGameStatistics: jest.fn(() => Promise.resolve([])),
    getHeadToHead: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({ getOrBuildPlayerProfile: jest.fn() }));

  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const successRes = mockRes();
  await historyHandler({ query: { status: "success", sport: "tennis" } }, successRes);

  expect(fakeDb.db.pronostic_history[0].status).toBe("success");
  expect(successRes.body.items).toHaveLength(1);
  expect(successRes.body.items[0].match_id).toBe("tn-555");
});

test("bloc 8, point 3 : une entrée tennis classée il y a plus de 5 jours disparaît réellement, une classée il y a moins de 5 jours reste", async () => {
  const fakeDb = makeFakeSupabase();
  const now = Date.now();
  const sixDaysAgo = new Date(now - 6 * 24 * 3600 * 1000).toISOString();
  const twoDaysAgo = new Date(now - 2 * 24 * 3600 * 1000).toISOString();
  fakeDb.db.pronostic_history.push(
    { match_id: "tn-old", sport: "tennis", status: "success", home_team_name: "A", away_team_name: "B", match_date: sixDaysAgo, verified_at: sixDaysAgo, prediction: {}, final_score: { home: 3, away: 0 } },
    { match_id: "tn-recent", sport: "tennis", status: "success", home_team_name: "C", away_team_name: "D", match_date: twoDaysAgo, verified_at: twoDaysAgo, prediction: {}, final_score: { home: 3, away: 1 } }
  );
  const { supabaseAnon } = require("../lib/supabaseAnon");
  supabaseAnon.from = fakeDb.from;
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getTennisApiKey: () => "test-key", getGameById: jest.fn(() => Promise.resolve(null)),
    getGameStatistics: jest.fn(() => Promise.resolve([])), getHeadToHead: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/tennis/statProfiles", () => ({ getOrBuildPlayerProfile: jest.fn() }));

  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const res = mockRes();
  await historyHandler({ query: { status: "success", sport: "tennis" } }, res);

  const ids = res.body.items.map((i) => i.match_id);
  expect(ids).not.toContain("tn-old");
  expect(ids).toContain("tn-recent");
  expect(fakeDb.db.pronostic_history.find((r) => r.match_id === "tn-old")).toBeUndefined();
});
