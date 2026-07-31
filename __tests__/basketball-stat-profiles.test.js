/**
 * lib/sports/basketball/statProfiles.js — bloc 3 : profil statistique RÉEL par
 * équipe basket, calculé à partir de ses derniers matchs réellement joués (jamais
 * une constante partagée entre équipes ou entre matchs), avec répartition
 * domicile/extérieur.
 */
const KEY = "test-basketball-key";

beforeEach(() => {
  jest.resetModules();
});

function game({ id, homeId, awayId, homeTotal, awayTotal, homeQ1, homeQ2, date, status = "FT" }) {
  return {
    id, date, status: { short: status },
    teams: { home: { id: homeId, name: `Team ${homeId}` }, away: { id: awayId, name: `Team ${awayId}` } },
    scores: {
      home: { quarter_1: homeQ1, quarter_2: homeQ2, quarter_3: null, quarter_4: null, total: homeTotal },
      away: { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, total: awayTotal },
    },
  };
}

function statsRow(homeId, awayId, home, away) {
  const toStats = (s) => [
    { type: "Total Rebounds", value: s.rebounds },
    { type: "Assists", value: s.assists },
    { type: "3 Points", value: `${s.tpm}/${s.tpa}` },
    { type: "Personal Fouls", value: s.fouls },
    { type: "Turnovers", value: s.turnovers },
    { type: "Free Throws", value: `${s.ftm}/${s.fta}` },
  ];
  return [
    { team: { id: homeId }, statistics: toStats(home) },
    { team: { id: awayId }, statistics: toStats(away) },
  ];
}

function mockFetchFor(games, statsByGameId) {
  return jest.fn((url) => {
    if (url.includes("/games?team=")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: games }) });
    }
    const m = url.match(/\/games\/statistics\?id=(\d+)/);
    if (m) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: statsByGameId[m[1]] || [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

test("sans clé/saison/id d'équipe, repli honnête sans appel réseau", async () => {
  const { getOrRefreshTeamProfile } = await import("../lib/sports/basketball/statProfiles.js");
  global.fetch = jest.fn();
  const profile = await getOrRefreshTeamProfile({ teamId: null, teamName: "X", season: "2025", apiKey: KEY });
  expect(profile.available).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("calcule les vraies moyennes pondérées par récence à partir des matchs réellement joués", async () => {
  const games = [
    game({ id: 1, homeId: 100, awayId: 200, homeTotal: 100, awayTotal: 90, homeQ1: 25, homeQ2: 25, date: "2026-07-01" }), // plus ancien, poids 1
    game({ id: 2, homeId: 100, awayId: 201, homeTotal: 110, awayTotal: 95, homeQ1: 28, homeQ2: 27, date: "2026-07-10" }), // plus récent, poids 2
  ];
  const statsByGameId = {
    1: statsRow(100, 200, { rebounds: 40, assists: 20, tpm: 8, tpa: 20, fouls: 18, turnovers: 12, ftm: 15, fta: 18 }, {}),
    2: statsRow(100, 201, { rebounds: 44, assists: 24, tpm: 12, tpa: 25, fouls: 20, turnovers: 10, ftm: 17, fta: 20 }, {}),
  };
  global.fetch = mockFetchFor(games, statsByGameId);

  const { getOrRefreshTeamProfile } = await import("../lib/sports/basketball/statProfiles.js");
  const profile = await getOrRefreshTeamProfile({ teamId: 100, teamName: "Team 100", season: "2025-2026", apiKey: KEY });

  expect(profile.available).toBe(true);
  expect(profile.matchesUsed).toBe(2);
  // Poids 1 (plus ancien, 100 pts) et poids 2 (plus récent, 110 pts) :
  // (100*1 + 110*2) / 3 = 320/3 ≈ 106,7 — jamais une simple moyenne (105).
  expect(profile.home.pointsFor.value).toBeCloseTo(106.7, 1);
  expect(profile.home.rebounds.value).toBeCloseTo((40 * 1 + 44 * 2) / 3, 1);
  expect(profile.home.threePointersMade.value).toBeCloseTo((8 * 1 + 12 * 2) / 3, 1);
  expect(profile.home.freeThrowsMade.value).toBeCloseTo((15 * 1 + 17 * 2) / 3, 1);
});

test("le profil domicile diffère du profil extérieur pour une même équipe", async () => {
  const games = [
    game({ id: 1, homeId: 100, awayId: 200, homeTotal: 120, awayTotal: 100, homeQ1: 30, homeQ2: 30, date: "2026-07-01" }),
    game({ id: 2, homeId: 300, awayId: 100, homeTotal: 80, awayTotal: 70, homeQ1: 20, homeQ2: 20, date: "2026-07-05" }),
  ];
  global.fetch = mockFetchFor(games, {
    1: statsRow(100, 200, { rebounds: 45, assists: 25, tpm: 10, tpa: 22, fouls: 16, turnovers: 9, ftm: 14, fta: 16 }, {}),
    2: statsRow(300, 100, {}, { rebounds: 30, assists: 15, tpm: 5, tpa: 15, fouls: 22, turnovers: 14, ftm: 10, fta: 13 }),
  });

  const { getOrRefreshTeamProfile } = await import("../lib/sports/basketball/statProfiles.js");
  const profile = await getOrRefreshTeamProfile({ teamId: 100, teamName: "Team 100", season: "2025-2026", apiKey: KEY });

  expect(profile.home.pointsFor.value).toBe(120);
  expect(profile.away.pointsFor.value).toBe(70);
  expect(profile.home.pointsFor.value).not.toBe(profile.away.pointsFor.value);
});

test("part réelle du 1er quart-temps / de la 1ère mi-temps, jamais une part fixe recopiée", async () => {
  const games = [game({ id: 1, homeId: 100, awayId: 200, homeTotal: 100, awayTotal: 90, homeQ1: 30, homeQ2: 20, date: "2026-07-01" })];
  global.fetch = mockFetchFor(games, { 1: statsRow(100, 200, { rebounds: 40, assists: 20, tpm: 8, tpa: 20, fouls: 18, turnovers: 12, ftm: 15, fta: 18 }, {}) });

  const { getOrRefreshTeamProfile } = await import("../lib/sports/basketball/statProfiles.js");
  const profile = await getOrRefreshTeamProfile({ teamId: 100, teamName: "Team 100", season: "2025-2026", apiKey: KEY });

  expect(profile.home.q1Share.value).toBeCloseTo(0.3, 5); // 30/100
  expect(profile.home.firstHalfShare.value).toBeCloseTo(0.5, 5); // (30+20)/100
});

test("deux équipes différentes ont des profils distincts — jamais mélangés", async () => {
  const gamesA = [game({ id: 1, homeId: 100, awayId: 200, homeTotal: 130, awayTotal: 90, homeQ1: 33, homeQ2: 32, date: "2026-07-01" })];
  const gamesB = [game({ id: 2, homeId: 300, awayId: 400, homeTotal: 85, awayTotal: 80, homeQ1: 20, homeQ2: 21, date: "2026-07-01" })];

  global.fetch = mockFetchFor(gamesA, { 1: statsRow(100, 200, { rebounds: 50, assists: 30, tpm: 15, tpa: 30, fouls: 15, turnovers: 8, ftm: 20, fta: 22 }, {}) });
  const { getOrRefreshTeamProfile } = await import("../lib/sports/basketball/statProfiles.js");
  const profileA = await getOrRefreshTeamProfile({ teamId: 100, teamName: "A", season: "2025-2026", apiKey: KEY });

  global.fetch = mockFetchFor(gamesB, { 2: statsRow(300, 400, { rebounds: 35, assists: 15, tpm: 4, tpa: 12, fouls: 22, turnovers: 16, ftm: 10, fta: 14 }, {}) });
  const profileB = await getOrRefreshTeamProfile({ teamId: 300, teamName: "B", season: "2025-2026", apiKey: KEY });

  expect(profileA.home.pointsFor.value).not.toBe(profileB.home.pointsFor.value);
  expect(profileA.home.rebounds.value).not.toBe(profileB.home.rebounds.value);
});

test("aucun match récent terminé trouvé : honnêtement indisponible, jamais une valeur inventée", async () => {
  global.fetch = mockFetchFor([game({ id: 1, homeId: 100, awayId: 200, homeTotal: null, awayTotal: null, homeQ1: null, homeQ2: null, date: "2026-08-01", status: "NS" })], {});
  const { getOrRefreshTeamProfile } = await import("../lib/sports/basketball/statProfiles.js");
  const profile = await getOrRefreshTeamProfile({ teamId: 100, teamName: "Team 100", season: "2025-2026", apiKey: KEY });
  expect(profile.available).toBe(false);
  expect(typeof profile.reason).toBe("string");
});

test("un écart-type réel est calculé pour les points (base du modèle de probabilité de victoire)", async () => {
  const games = [
    game({ id: 1, homeId: 100, awayId: 200, homeTotal: 100, awayTotal: 90, homeQ1: 25, homeQ2: 25, date: "2026-07-01" }),
    game({ id: 2, homeId: 100, awayId: 201, homeTotal: 120, awayTotal: 95, homeQ1: 30, homeQ2: 30, date: "2026-07-10" }),
  ];
  global.fetch = mockFetchFor(games, {
    1: statsRow(100, 200, { rebounds: 40, assists: 20, tpm: 8, tpa: 20, fouls: 18, turnovers: 12, ftm: 15, fta: 18 }, {}),
    2: statsRow(100, 201, { rebounds: 42, assists: 22, tpm: 10, tpa: 22, fouls: 19, turnovers: 11, ftm: 16, fta: 19 }, {}),
  });
  const { getOrRefreshTeamProfile } = await import("../lib/sports/basketball/statProfiles.js");
  const profile = await getOrRefreshTeamProfile({ teamId: 100, teamName: "Team 100", season: "2025-2026", apiKey: KEY });
  expect(profile.home.pointsFor.stdDev).toBeGreaterThan(0);
});

test("appels rapprochés pour la même équipe/saison : un seul appel réel (cache 24h)", async () => {
  const games = [game({ id: 1, homeId: 100, awayId: 200, homeTotal: 100, awayTotal: 90, homeQ1: 25, homeQ2: 25, date: "2026-07-01" })];
  const fetchMock = mockFetchFor(games, { 1: statsRow(100, 200, { rebounds: 40, assists: 20, tpm: 8, tpa: 20, fouls: 18, turnovers: 12, ftm: 15, fta: 18 }, {}) });
  global.fetch = fetchMock;
  const { getOrRefreshTeamProfile } = await import("../lib/sports/basketball/statProfiles.js");

  await Promise.all([
    getOrRefreshTeamProfile({ teamId: 100, teamName: "Team 100", season: "2025-2026", apiKey: KEY }),
    getOrRefreshTeamProfile({ teamId: 100, teamName: "Team 100", season: "2025-2026", apiKey: KEY }),
  ]);
  const gamesCalls = fetchMock.mock.calls.filter(([url]) => url.includes("/games?team=")).length;
  expect(gamesCalls).toBe(1);
});
