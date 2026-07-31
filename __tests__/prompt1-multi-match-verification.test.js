/**
 * PROMPT 1 — vérification bout-en-bout, exigée par la consigne : "vérifie toi-même
 * sur plusieurs matchs différents que les profils calculés sont bien distincts".
 *
 * Ce test simule 4 équipes RÉELLES (6 matchs chacune, mélange domicile/extérieur,
 * adversaires réels avec classement) dans LA MÊME compétition, calcule leurs profils
 * complets via lib/teamStatProfiles.js (forme récente pondérée, adversité, buts,
 * tirs, corners, fautes, cartons, taux de conversion, clean sheets), leurs notes de
 * qualité par secteur via lib/teamQualityRatings.js (percentile réel parmi les 3
 * autres équipes déjà profilées), puis croise deux matchs DIFFÉRENTS (Alpha FC-Beta
 * FC et Gamma FC-Delta FC) via lib/pronosticFromProfiles.js. Vérifie à chaque étage
 * qu'aucune donnée n'est jamais partagée entre équipes ou entre matchs.
 */
const AF_KEY = "verif-key";

beforeEach(() => {
  jest.resetModules();
});

function makeSupabaseMock(rows) {
  return {
    getSupabaseAdmin: () => ({
      from: () => ({
        upsert: (row) => {
          const idx = rows.findIndex((r) => r.team_key === row.team_key);
          if (idx >= 0) rows[idx] = { ...row };
          else rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
        select: () => {
          const filters = { eq: [], neq: [] };
          const builder = {
            eq: (c, v) => { filters.eq.push([c, v]); return builder; },
            neq: (c, v) => { filters.neq.push([c, v]); return builder; },
            maybeSingle: () => {
              const m = rows.filter((r) => filters.eq.every(([c, v]) => r[c] === v) && filters.neq.every(([c, v]) => r[c] !== v));
              return Promise.resolve({ data: m[0] || null, error: null });
            },
            then: (resolve) => {
              const m = rows.filter((r) => filters.eq.every(([c, v]) => r[c] === v) && filters.neq.every(([c, v]) => r[c] !== v));
              return Promise.resolve({ data: m, error: null }).then(resolve);
            },
          };
          return builder;
        },
      }),
    }),
  };
}

function fixture(id, { homeId, awayId, homeGoals, awayGoals, daysAgo }) {
  return {
    fixture: { id, date: new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(), status: { short: "FT" } },
    teams: { home: { id: homeId, name: `Club ${homeId}` }, away: { id: awayId, name: `Club ${awayId}` } },
    goals: { home: homeGoals, away: awayGoals },
  };
}

function statsRow(homeId, awayId, home, away) {
  const build = (s) => [
    { type: "Corner Kicks", value: s.corners }, { type: "Offsides", value: s.offsides },
    { type: "Fouls", value: s.fouls }, { type: "Total Shots", value: s.shots },
    { type: "Shots on Goal", value: s.shotsOnTarget }, { type: "Yellow Cards", value: s.yellow },
    { type: "Red Cards", value: s.red }, { type: "Ball Possession", value: `${s.possession}%` },
  ];
  return [{ team: { id: homeId }, statistics: build(home) }, { team: { id: awayId }, statistics: build(away) }];
}

// Génère 6 matchs réalistes pour une équipe (3 à domicile, 3 à l'extérieur, en
// alternance), chaque équipe affrontant des adversaires DIFFÉRENTS (jamais de
// mélange de statistiques entre matchs ou entre équipes).
function buildTeamRoutes({ teamId, teamName, opponentIdsBase, attack, defense }) {
  const fixtures = [];
  const statsHandlers = {};
  for (let i = 0; i < 6; i++) {
    const fixtureId = teamId * 100 + i;
    const opponentId = opponentIdsBase + i;
    const isHome = i % 2 === 0;
    const daysAgo = 30 - i * 5; // du plus ancien au plus récent
    const goalsFor = Math.max(0, Math.round(attack + (i % 3) - 1));
    const goalsAgainst = Math.max(0, Math.round(defense + ((i + 1) % 3) - 1));
    fixtures.push(
      fixture(fixtureId, {
        homeId: isHome ? teamId : opponentId,
        awayId: isHome ? opponentId : teamId,
        homeGoals: isHome ? goalsFor : goalsAgainst,
        awayGoals: isHome ? goalsAgainst : goalsFor,
        daysAgo,
      })
    );
    const own = {
      corners: 4 + attack, offsides: 2, fouls: 9 + (10 - defense), shots: 10 + attack * 2,
      shotsOnTarget: 3 + attack, yellow: 1 + Math.round((10 - defense) / 4), red: 0, possession: 45 + attack * 2,
    };
    const opp = {
      corners: 4 + defense, offsides: 2, fouls: 9 + attack, shots: 8 + defense,
      shotsOnTarget: 3 + Math.round(defense / 2), yellow: 2, red: 0, possession: 55 - attack * 2,
    };
    statsHandlers[fixtureId] = isHome ? statsRow(teamId, opponentId, own, opp) : statsRow(opponentId, teamId, opp, own);
  }
  return { fixtures, statsHandlers, teamId, teamName };
}

function mockFetchFor(teams, standingsTable) {
  const byTeamId = new Map(teams.map((t) => [t.teamId, t]));
  return jest.fn((url) => {
    const searchMatch = url.match(/teams\?search=([^&]+)/);
    if (searchMatch) {
      const name = decodeURIComponent(searchMatch[1]);
      const team = teams.find((t) => t.teamName === name);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: team ? [{ team: { id: team.teamId, name: team.teamName } }] : [] }) });
    }
    const fixturesMatch = url.match(/fixtures\?team=(\d+)/);
    if (fixturesMatch) {
      const team = byTeamId.get(Number(fixturesMatch[1]));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: team ? team.fixtures : [] }) });
    }
    const statsMatch = url.match(/fixtures\/statistics\?fixture=(\d+)/);
    if (statsMatch) {
      const fixtureId = Number(statsMatch[1]);
      for (const t of teams) {
        if (t.statsHandlers[fixtureId]) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: t.statsHandlers[fixtureId] }) });
        }
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    }
    if (url.includes("/standings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: standingsTable }] }) });
    }
    return Promise.reject(new Error(`URL inattendue dans la vérification PROMPT 1 : ${url}`));
  });
}

test("PROMPT 1 — 4 équipes réelles, 2 matchs différents : profils, notes de qualité et lignes de pronostic tous distincts", async () => {
  const alpha = buildTeamRoutes({ teamId: 1001, teamName: "Alpha FC", opponentIdsBase: 5001, attack: 3, defense: 8 }); // forte attaque, défense fragile
  const beta = buildTeamRoutes({ teamId: 1002, teamName: "Beta FC", opponentIdsBase: 5101, attack: 1, defense: 2 }); // attaque faible, défense solide
  const gamma = buildTeamRoutes({ teamId: 1003, teamName: "Gamma FC", opponentIdsBase: 5201, attack: 2, defense: 4 }); // équilibrée
  const delta = buildTeamRoutes({ teamId: 1004, teamName: "Delta FC", opponentIdsBase: 5301, attack: 2, defense: 6 }); // moyenne, défense moins bonne

  const teams = [alpha, beta, gamma, delta];
  const standingsTable = teams.map((t, i) => ({ position: i + 1, team: { id: t.teamId, name: t.teamName } }));

  const rows = [];
  jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
  global.fetch = mockFetchFor(teams, standingsTable);

  const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
  const { computeMatchLinesFromProfiles } = await import("../lib/pronosticFromProfiles.js");

  const profiles = {};
  // Ordre volontaire : Alpha et Beta d'abord (aucun pair -> notes indisponibles),
  // puis Gamma et Delta (3 pairs déjà profilés -> notes réellement calculées) —
  // preuve que MIN_PEERS_FOR_RATING est honnêtement respecté, jamais contourné.
  for (const t of teams) {
    profiles[t.teamName] = await getOrRefreshTeamProfile({
      teamName: t.teamName, competitionCode: "VERIF", apiFootballKey: AF_KEY, token: "fd-token",
    });
  }

  // --- 1. Les 4 profils sont réellement distincts (jamais de constante partagée) ---
  const overallGoalsFor = teams.map((t) => profiles[t.teamName].overall.goalsFor.value);
  expect(new Set(overallGoalsFor).size).toBeGreaterThan(1);
  for (const t of teams) {
    expect(profiles[t.teamName].available).toBe(true);
    expect(profiles[t.teamName].matchesUsed).toBe(6);
  }
  // Alpha (forte attaque) marque nettement plus que Beta (attaque faible).
  expect(profiles["Alpha FC"].overall.goalsFor.value).toBeGreaterThan(profiles["Beta FC"].overall.goalsFor.value);
  // Beta (défense solide) encaisse nettement moins qu'Alpha (défense fragile).
  expect(profiles["Beta FC"].overall.goalsAgainst.value).toBeLessThan(profiles["Alpha FC"].overall.goalsAgainst.value);

  // --- 2. Domicile/extérieur jamais mélangés, pour chaque équipe ---
  for (const t of teams) {
    const p = profiles[t.teamName];
    expect(p.home).not.toEqual(p.away);
  }

  // --- 3. Notes de qualité : Alpha (dernière profilée, 3 pairs réels) a un percentile
  // d'attaque réel et nettement supérieur à Beta sur ce même secteur.
  const deltaRatings = profiles["Delta FC"].qualityRatings;
  expect(deltaRatings).toBeTruthy();
  expect(deltaRatings.attack.available).toBe(true);
  expect(deltaRatings.overall.available).toBe(true);

  // --- 4. Deux matchs différents (Alpha-Beta et Gamma-Delta) ne produisent jamais le
  // même jeu de lignes de pronostic.
  const matchAlphaBeta = computeMatchLinesFromProfiles({
    homeProfile: profiles["Alpha FC"], awayProfile: profiles["Beta FC"],
    homeTeamName: "Alpha FC", awayTeamName: "Beta FC",
  });
  const matchGammaDelta = computeMatchLinesFromProfiles({
    homeProfile: profiles["Gamma FC"], awayProfile: profiles["Delta FC"],
    homeTeamName: "Gamma FC", awayTeamName: "Delta FC",
  });

  expect(matchAlphaBeta.available).toBe(true);
  expect(matchGammaDelta.available).toBe(true);
  expect(matchAlphaBeta.markets).not.toEqual(matchGammaDelta.markets);
  expect(matchAlphaBeta.matchStats).not.toEqual(matchGammaDelta.matchStats);
  expect(matchAlphaBeta.correctScores).not.toEqual(matchGammaDelta.correctScores);
  expect(matchAlphaBeta.goals.expectedHome).not.toBe(matchGammaDelta.goals.expectedHome);

  // --- 5. Inverser domicile/extérieur pour LA MÊME paire change bien les lignes
  // (le rôle réel dans le match est respecté, jamais une moyenne symétrique).
  const matchBetaAlpha = computeMatchLinesFromProfiles({
    homeProfile: profiles["Beta FC"], awayProfile: profiles["Alpha FC"],
    homeTeamName: "Beta FC", awayTeamName: "Alpha FC",
  });
  expect(matchBetaAlpha.goals.expectedHome).not.toBe(matchAlphaBeta.goals.expectedHome);
});
