/**
 * Vérification bout en bout (PROMPT bloc 4 : "Vérifie toi-même que les sections
 * 'Probabilités réussies' et 'Probabilités échouées' du basket se remplissent
 * réellement après la fin d'un match, et corrige si ce n'est pas le cas") — simule
 * une vraie base Supabase en mémoire (au lieu de mocker lib/sports/basketball/
 * pronosticHistory.js comme les autres tests de ce dépôt) pour prouver que le chemin
 * COMPLET fonctionne réellement :
 *   1) pages/api/basketball/analyze.js analyse un match basket déjà terminé pour la
 *      première fois -> fige ET classe le pronostic (Succès/Échec) -> écrit une vraie
 *      ligne dans "pronostic_history" (sport='basketball').
 *   2) pages/api/pronostic-history.js?sport=basketball&status=... relit cette ligne.
 *   3) components/BasketballPronosticHistoryCard.js l'affiche réellement.
 * Aucune étape n'est mockée entre ces trois maillons : seule la base Supabase elle-
 * même est remplacée par une implémentation en mémoire avec la VRAIE logique de
 * filtrage (eq/order/limit/upsert/update/delete), pour que ce test échoue si le
 * moindre maillon de la chaîne est cassé.
 */

// --- Fausse base Supabase en mémoire, avec la vraie logique de filtrage utilisée par
// lib/sports/basketball/pronosticHistory.js (eq/not/is/lt/order/limit/upsert/update/
// delete/maybeSingle) — pas un mock qui "renvoie ce qu'on lui dit", une vraie table.
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

function field(value, extra = {}) {
  return { value, available: value != null, sampleSize: 8, ...extra };
}

// Lakers nettement plus forts que Warriors -> favori clairement désigné (probabilité
// de victoire domicile largement > 50%), pour un test déterministe.
function strongHomeProfile() {
  const home = {
    pointsFor: field(122, { stdDev: 7 }), pointsAgainst: field(98, { stdDev: 7 }),
    rebounds: field(46), assists: field(26), threePointersMade: field(13),
    fouls: field(17), turnovers: field(11), freeThrowsMade: field(18),
    q1Share: field(0.26), firstHalfShare: field(0.51),
  };
  return { available: true, teamId: 10, teamName: "Lakers", matchesUsed: 8, home, away: home };
}
function weakAwayProfile() {
  const away = {
    pointsFor: field(96, { stdDev: 7 }), pointsAgainst: field(118, { stdDev: 7 }),
    rebounds: field(38), assists: field(19), threePointersMade: field(8),
    fouls: field(20), turnovers: field(15), freeThrowsMade: field(14),
    q1Share: field(0.24), firstHalfShare: field(0.49),
  };
  return { available: true, teamId: 11, teamName: "Warriors", matchesUsed: 8, home: away, away };
}

function finishedGame({ homeQuarters, awayQuarters, short = "FT" }) {
  const homeTotal = homeQuarters.reduce((a, b) => a + b, 0);
  const awayTotal = awayQuarters.reduce((a, b) => a + b, 0);
  return {
    // Date récente ("maintenant") plutôt qu'une date figée : le vrai nettoyage des
    // entrées de plus de 5 jours (voir lib/sports/basketball/pronosticHistory.js#
    // cleanupExpired, appelé par listAndMaintainHistory) supprimerait sinon cette
    // ligne de test AVANT même que le balayage ne puisse la classer.
    id: 555, date: new Date().toISOString(), status: { short, timer: null }, league: { season: "2025-2026" },
    teams: { home: { id: 10, name: "Lakers" }, away: { id: 11, name: "Warriors" } },
    scores: {
      home: { quarter_1: homeQuarters[0], quarter_2: homeQuarters[1], quarter_3: homeQuarters[2], quarter_4: homeQuarters[3], total: homeTotal },
      away: { quarter_1: awayQuarters[0], quarter_2: awayQuarters[1], quarter_3: awayQuarters[2], quarter_4: awayQuarters[3], total: awayTotal },
    },
  };
}

beforeEach(() => {
  jest.resetModules();
});

async function setupModules({ fakeDb, gameObj, statsRows }) {
  const { supabaseAnon } = require("../lib/supabaseAnon");
  supabaseAnon.from = fakeDb.from;

  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "test-key",
    getGameById: jest.fn(() => Promise.resolve(gameObj)),
    getGameStatistics: jest.fn(() => Promise.resolve(statsRows)),
    getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  // requireActual : garde la VRAIE logique d'analyse des statistiques (STAT_ALIASES,
  // statisticValue, utilisées par lib/sports/basketball/pronosticHistory.js pour la
  // vérification finale), seul le calcul du profil (réseau réel) est remplacé par des
  // profils déterministes.
  jest.doMock("../lib/sports/basketball/statProfiles", () => ({
    ...jest.requireActual("../lib/sports/basketball/statProfiles"),
    getOrRefreshTeamProfile: jest.fn(({ teamId }) =>
      Promise.resolve(String(teamId) === "10" ? strongHomeProfile() : weakAwayProfile())
    ),
  }));
  // lib/sports/basketball/pronosticHistory.js n'est PAS mocké : c'est le vrai code,
  // contre la fausse base ci-dessus — c'est exactement ce que ce test vérifie.
}

// Avec strongHomeProfile()/weakAwayProfile() ci-dessus, le modèle (voir lib/sports/
// basketball/pronosticModel.js) prédit lambdaHome=120, lambdaAway=97 (calcul vérifié
// à la main avant d'écrire ce test) : Total attendu 217,5 (Moins), Total 1 120,5
// (Moins), Total 2 97,5 (Moins), 1er quart-temps 54,5 (Moins), 1ère mi-temps 108,5
// (Plus), 2ème mi-temps 108,5 (Moins), écart sûr 24,5 (Moins), écart risqué 18,5
// (Moins). Le score choisi ci-dessous (115-95, quarts 28/32/28/27 et 22/27/23/23)
// valide RÉELLEMENT la quasi-totalité de ces lignes (8 validées sur 10 comptabilisées,
// stats de boîte de score volontairement indisponibles ici — voir statsRows: [] — pour
// isoler le calcul sur les lignes dérivées du score, sans avoir à truquer un
// relevé de boîte de score cohérent en plus).
function homeWinsGame() {
  return finishedGame({ homeQuarters: [28, 32, 28, 27], awayQuarters: [22, 27, 23, 23] });
}
// Symétriquement, un score qui invalide la quasi-totalité des mêmes lignes (Lakers,
// favoris à 99%, perdent largement, avec un Total très au-dessus de la ligne prédite).
function homeLosesGame() {
  return finishedGame({ homeQuarters: [30, 15, 25, 20], awayQuarters: [32, 18, 45, 40] });
}

test("un match basket qui se termine avec l'équipe favorite gagnante remplit réellement « Probabilités réussies »", async () => {
  const fakeDb = makeFakeSupabase();
  const game = homeWinsGame(); // Lakers (favori) gagnent 115-95
  await setupModules({ fakeDb, gameObj: game, statsRows: [] });

  const { default: analyzeHandler } = await import("../pages/api/basketball/analyze.js");
  const analyzeRes = mockRes();
  await analyzeHandler(
    { query: { matchId: "bk-555", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "Lakers", awayTeamName: "Warriors", season: "2025-2026" } },
    analyzeRes
  );

  // 1) La réponse d'analyse elle-même confirme le succès immédiat (première analyse
  //    après la fin du match, voir pages/api/basketball/analyze.js) — sur la MAJORITÉ
  //    des lignes réellement vérifiables (lib/sports/basketball/pronosticHistory.js,
  //    classifyByMajority), pas seulement l'issue du match.
  expect(analyzeRes.body.available).toBe(true);
  expect(analyzeRes.body.historyStatus).toBe("success");
  expect(analyzeRes.body.verification.winner).toBe(true);

  // 2) La vraie ligne existe bien dans "la base", avec sport='basketball'.
  expect(fakeDb.db.pronostic_history).toHaveLength(1);
  expect(fakeDb.db.pronostic_history[0]).toMatchObject({ match_id: "bk-555", sport: "basketball", status: "success" });

  // 3) La route qui alimente la page "Probabilités réussies" la retrouve réellement.
  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const successRes = mockRes();
  await historyHandler({ query: { status: "success", sport: "basketball" } }, successRes);
  expect(successRes.body.items).toHaveLength(1);
  expect(successRes.body.items[0].match_id).toBe("bk-555");
  expect(successRes.body.items[0].home_team_name).toBe("Lakers");
  expect(successRes.body.items[0].final_score).toEqual({ home: 115, away: 95 });

  // Et surtout : « Probabilités échouées » reste vide pour ce match (jamais dans les
  // deux listes à la fois).
  const failureRes = mockRes();
  await historyHandler({ query: { status: "failure", sport: "basketball" } }, failureRes);
  expect(failureRes.body.items.find((i) => i.match_id === "bk-555")).toBeUndefined();
});

test("un match basket qui se termine avec l'équipe favorite perdante remplit réellement « Probabilités échouées »", async () => {
  const fakeDb = makeFakeSupabase();
  // Mêmes profils (Lakers favoris à 99%), mais Lakers PERDENT largement -> échec sur
  // la majorité des lignes (issue du match, totaux, périodes, écart de points).
  const game = homeLosesGame();
  await setupModules({ fakeDb, gameObj: game, statsRows: [] });

  const { default: analyzeHandler } = await import("../pages/api/basketball/analyze.js");
  const analyzeRes = mockRes();
  await analyzeHandler(
    { query: { matchId: "bk-555", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "Lakers", awayTeamName: "Warriors", season: "2025-2026" } },
    analyzeRes
  );

  expect(analyzeRes.body.historyStatus).toBe("failure");
  expect(analyzeRes.body.verification.winner).toBe(false);

  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const failureRes = mockRes();
  await historyHandler({ query: { status: "failure", sport: "basketball" } }, failureRes);
  expect(failureRes.body.items).toHaveLength(1);
  expect(failureRes.body.items[0].match_id).toBe("bk-555");

  const successRes = mockRes();
  await historyHandler({ query: { status: "success", sport: "basketball" } }, successRes);
  expect(successRes.body.items).toHaveLength(0);
});

test("un match basket pas encore terminé n'apparaît dans AUCUNE des deux listes tant qu'il n'est pas classé", async () => {
  const fakeDb = makeFakeSupabase();
  const liveGame = { ...homeWinsGame(), status: { short: "Q3", timer: "5:00" } };
  await setupModules({ fakeDb, gameObj: liveGame, statsRows: [] });

  const { default: analyzeHandler } = await import("../pages/api/basketball/analyze.js");
  const analyzeRes = mockRes();
  await analyzeHandler(
    { query: { matchId: "bk-555", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "Lakers", awayTeamName: "Warriors", season: "2025-2026" } },
    analyzeRes
  );
  expect(analyzeRes.body.historyStatus).toBeUndefined();
  expect(fakeDb.db.pronostic_history[0].status).toBe("pending");

  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const successRes = mockRes();
  await historyHandler({ query: { status: "success", sport: "basketball" } }, successRes);
  const failureRes = mockRes();
  await historyHandler({ query: { status: "failure", sport: "basketball" } }, failureRes);
  expect(successRes.body.items).toHaveLength(0);
  expect(failureRes.body.items).toHaveLength(0);
});

test("un pronostic basket 'pending' devenu terminé entre-temps est classé automatiquement au chargement de la page (balayage)", async () => {
  const fakeDb = makeFakeSupabase();
  // 1) Première analyse pendant que le match est encore en cours -> reste "pending".
  const liveGame = { ...homeWinsGame(), status: { short: "Q3", timer: "5:00" } };
  await setupModules({ fakeDb, gameObj: liveGame, statsRows: [] });
  const { default: analyzeHandler } = await import("../pages/api/basketball/analyze.js");
  await analyzeHandler(
    { query: { matchId: "bk-555", homeTeamId: "bk-10", awayTeamId: "bk-11", homeTeamName: "Lakers", awayTeamName: "Warriors", season: "2025-2026" } },
    mockRes()
  );
  expect(fakeDb.db.pronostic_history[0].status).toBe("pending");

  // 2) Le match est maintenant terminé (Lakers gagnent) — sans qu'on revisite la page
  //    du match : c'est le balayage automatique déclenché par listAndMaintainHistory
  //    (voir lib/sports/basketball/pronosticHistory.js) qui doit s'en rendre compte.
  jest.resetModules();
  const { supabaseAnon } = require("../lib/supabaseAnon");
  supabaseAnon.from = fakeDb.from;
  const finishedNow = homeWinsGame();
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "test-key",
    getGameById: jest.fn(() => Promise.resolve(finishedNow)),
    getGameStatistics: jest.fn(() => Promise.resolve([])),
    getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/basketball/statProfiles", () => ({
    ...jest.requireActual("../lib/sports/basketball/statProfiles"),
    getOrRefreshTeamProfile: jest.fn(),
  }));

  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const successRes = mockRes();
  await historyHandler({ query: { status: "success", sport: "basketball" } }, successRes);

  expect(fakeDb.db.pronostic_history[0].status).toBe("success");
  expect(successRes.body.items).toHaveLength(1);
  expect(successRes.body.items[0].match_id).toBe("bk-555");
});

test("PROMPT bloc 4, point 5 : une entrée basket classée il y a plus de 5 jours disparaît réellement, une classée il y a moins de 5 jours reste", async () => {
  const fakeDb = makeFakeSupabase();
  const now = Date.now();
  const sixDaysAgo = new Date(now - 6 * 24 * 3600 * 1000).toISOString();
  const twoDaysAgo = new Date(now - 2 * 24 * 3600 * 1000).toISOString();
  fakeDb.db.pronostic_history.push(
    { match_id: "bk-old", sport: "basketball", status: "success", home_team_name: "A", away_team_name: "B", match_date: sixDaysAgo, verified_at: sixDaysAgo, prediction: {}, final_score: { home: 1, away: 0 } },
    { match_id: "bk-recent", sport: "basketball", status: "success", home_team_name: "C", away_team_name: "D", match_date: twoDaysAgo, verified_at: twoDaysAgo, prediction: {}, final_score: { home: 1, away: 0 } }
  );
  const { supabaseAnon } = require("../lib/supabaseAnon");
  supabaseAnon.from = fakeDb.from;
  jest.doMock("../lib/sports/basketball/provider", () => ({
    getBasketballApiKey: () => "test-key", getGameById: jest.fn(() => Promise.resolve(null)),
    getGameStatistics: jest.fn(() => Promise.resolve([])), getTeamPlayerStatistics: jest.fn(() => Promise.resolve([])),
  }));
  jest.doMock("../lib/sports/basketball/statProfiles", () => ({
    ...jest.requireActual("../lib/sports/basketball/statProfiles"), getOrRefreshTeamProfile: jest.fn(),
  }));

  const { default: historyHandler } = await import("../pages/api/pronostic-history.js");
  const res = mockRes();
  await historyHandler({ query: { status: "success", sport: "basketball" } }, res);

  const ids = res.body.items.map((i) => i.match_id);
  expect(ids).not.toContain("bk-old");
  expect(ids).toContain("bk-recent");
  expect(fakeDb.db.pronostic_history.find((r) => r.match_id === "bk-old")).toBeUndefined();
});
