/**
 * lib/sports/tennis/statProfiles.js — profil RÉEL d'un joueur (bloc 7), construit à
 * partir de ses vrais matchs récents (API-Tennis), avec repli documenté (surface ->
 * matchs récents toutes surfaces -> moyenne de circuit) jamais une valeur inventée
 * présentée comme mesurée. Vérifie surtout que deux joueurs différents produisent
 * bien des profils différents (jamais les mêmes valeurs recopiées).
 */
const KEY = "test-tennis-key";

function finishedGame({ id, homeId, awayId, homeSets, awaySets, surface = "hard", daysAgo = 5 }) {
  const scores = { home: {}, away: {} };
  homeSets.forEach((v, i) => (scores.home[`set_${i + 1}`] = v));
  awaySets.forEach((v, i) => (scores.away[`set_${i + 1}`] = v));
  return {
    id, status: { long: "Finished", short: "FT" },
    date: new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(),
    league: { surface },
    teams: { home: { id: homeId, name: "Home Player" }, away: { id: awayId, name: "Away Player" } },
    scores,
  };
}

beforeEach(() => {
  jest.resetModules();
});

test("sans identifiant joueur : indisponible sans jamais appeler l'API", async () => {
  jest.doMock("../lib/sports/tennis/provider", () => ({ getPlayerGames: jest.fn(), getRankings: jest.fn(), getGameStatistics: jest.fn() }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  const profile = await getOrBuildPlayerProfile({ playerId: null, playerName: "X", surface: "Dur", apiKey: KEY });
  expect(profile.available).toBe(false);
});

test("aucun match exploitable : repli sur la moyenne de circuit, honnêtement estimée, jamais indisponible", async () => {
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getPlayerGames: jest.fn(() => Promise.resolve([])),
    getRankings: jest.fn(() => Promise.resolve([])),
    getGameStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  const profile = await getOrBuildPlayerProfile({ playerId: 999, playerName: "Nouveau Joueur", surface: "Dur", apiKey: KEY });
  expect(profile.available).toBe(true);
  expect(profile.serveWinPct.basis).toBe("tour_average");
  expect(profile.serveWinPct.estimated).toBe(true);
  expect(profile.matchesUsed).toBe(0);
});

test("des matchs récents réels (sans statistiques détaillées) donnent un profil dérivé du vrai ratio de jeux gagnés/perdus", async () => {
  const games = [
    finishedGame({ id: 1, homeId: 10, awayId: 20, homeSets: [6, 6], awaySets: [2, 3], surface: "hard", daysAgo: 3 }),
    finishedGame({ id: 2, homeId: 10, awayId: 21, homeSets: [6, 6], awaySets: [1, 4], surface: "hard", daysAgo: 8 }),
    finishedGame({ id: 3, homeId: 10, awayId: 22, homeSets: [6, 6], awaySets: [3, 2], surface: "hard", daysAgo: 12 }),
  ];
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getPlayerGames: jest.fn(() => Promise.resolve(games)),
    getRankings: jest.fn(() => Promise.resolve([])),
    getGameStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  const profile = await getOrBuildPlayerProfile({ playerId: 10, playerName: "Joueur Dominant", surface: "Dur", apiKey: KEY });

  expect(profile.available).toBe(true);
  expect(profile.matchesUsed).toBe(3);
  // Ce joueur gagne largement ses jeux -> estimation de service au-dessus de la moyenne du circuit.
  expect(profile.serveWinPct.value).toBeGreaterThan(62);
  // "hard" (brut) -> "Dur" (libellé mappé, voir lib/sports/tennis/mapper.js#SURFACE_LABELS)
  // correspond bien à la surface demandée : assez d'échantillon -> basis "surface".
  expect(profile.serveWinPct.basis).toBe("surface");
});

test("avec assez de matchs sur LA surface exacte du tournoi : basis = 'surface', pas 'recent'", async () => {
  const games = [
    finishedGame({ id: 1, homeId: 10, awayId: 20, homeSets: [6, 6], awaySets: [3, 4], surface: "clay", daysAgo: 3 }),
    finishedGame({ id: 2, homeId: 10, awayId: 21, homeSets: [6, 6], awaySets: [4, 3], surface: "clay", daysAgo: 8 }),
    finishedGame({ id: 3, homeId: 10, awayId: 22, homeSets: [6, 3, 6], awaySets: [4, 6, 4], surface: "clay", daysAgo: 12 }),
  ];
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getPlayerGames: jest.fn(() => Promise.resolve(games)),
    getRankings: jest.fn(() => Promise.resolve([])),
    getGameStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  const profile = await getOrBuildPlayerProfile({ playerId: 10, playerName: "Terrien", surface: "Terre battue", apiKey: KEY });

  expect(profile.serveWinPct.basis).toBe("surface");
  expect(profile.serveWinPct.estimated).toBe(false);
  expect(profile.surfaceMatchesUsed).toBe(3);
});

test("deux joueurs différents (formes différentes) produisent des profils DIFFÉRENTS, jamais les mêmes valeurs", async () => {
  const strongGames = [
    finishedGame({ id: 1, homeId: 10, awayId: 20, homeSets: [6, 6], awaySets: [1, 2], surface: "hard", daysAgo: 3 }),
    finishedGame({ id: 2, homeId: 10, awayId: 21, homeSets: [6, 6], awaySets: [0, 1], surface: "hard", daysAgo: 6 }),
    finishedGame({ id: 3, homeId: 10, awayId: 22, homeSets: [6, 6], awaySets: [2, 1], surface: "hard", daysAgo: 9 }),
  ];
  const weakGames = [
    finishedGame({ id: 4, homeId: 30, awayId: 40, homeSets: [2, 3], awaySets: [6, 6], surface: "hard", daysAgo: 3 }),
    finishedGame({ id: 5, homeId: 30, awayId: 41, homeSets: [1, 4], awaySets: [6, 6], surface: "hard", daysAgo: 6 }),
    finishedGame({ id: 6, homeId: 30, awayId: 42, homeSets: [3, 2], awaySets: [6, 6], surface: "hard", daysAgo: 9 }),
  ];

  jest.doMock("../lib/sports/tennis/provider", () => ({
    getPlayerGames: jest.fn(({ player }) => Promise.resolve(player === 10 ? strongGames : weakGames)),
    getRankings: jest.fn(() => Promise.resolve([])),
    getGameStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  const strong = await getOrBuildPlayerProfile({ playerId: 10, playerName: "Dominant", surface: "Dur", apiKey: KEY });
  const weak = await getOrBuildPlayerProfile({ playerId: 30, playerName: "En difficulté", surface: "Dur", apiKey: KEY });

  expect(strong.serveWinPct.value).not.toBe(weak.serveWinPct.value);
  expect(strong.serveWinPct.value).toBeGreaterThan(weak.serveWinPct.value);
});

test("des statistiques de match détaillées (aces, doubles fautes, service) sont utilisées quand disponibles", async () => {
  const games = [finishedGame({ id: 1, homeId: 10, awayId: 20, homeSets: [6, 6], awaySets: [4, 4], surface: "hard", daysAgo: 3 })];
  const rawStats = [
    { team: { id: 10 }, statistics: [
      { type: "Aces", value: 12 }, { type: "Double Faults", value: 1 },
      { type: "1st Serve", value: "68%" }, { type: "1st Serve Points Won", value: "80%" },
      { type: "2nd Serve Points Won", value: "55%" }, { type: "Break Points Won", value: "5/6" },
    ] },
    { team: { id: 20 }, statistics: [
      { type: "Aces", value: 2 }, { type: "Double Faults", value: 5 },
      { type: "1st Serve", value: "50%" }, { type: "1st Serve Points Won", value: "55%" },
      { type: "2nd Serve Points Won", value: "40%" }, { type: "Break Points Won", value: "1/6" },
    ] },
  ];
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getPlayerGames: jest.fn(() => Promise.resolve(games)),
    getRankings: jest.fn(() => Promise.resolve([])),
    getGameStatistics: jest.fn(() => Promise.resolve(rawStats)),
  }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  const profile = await getOrBuildPlayerProfile({ playerId: 10, playerName: "Gros serveur", surface: "Dur", apiKey: KEY });

  expect(profile.acesPerMatch.value).toBe(12);
  expect(profile.doubleFaultsPerMatch.value).toBe(1);
});

test("fatigue : compte réellement les matchs joués dans les 14 derniers jours", async () => {
  const games = [
    finishedGame({ id: 1, homeId: 10, awayId: 20, homeSets: [6, 6], awaySets: [4, 4], surface: "hard", daysAgo: 2 }),
    finishedGame({ id: 2, homeId: 10, awayId: 21, homeSets: [6, 6], awaySets: [4, 4], surface: "hard", daysAgo: 5 }),
    finishedGame({ id: 3, homeId: 10, awayId: 22, homeSets: [6, 6], awaySets: [4, 4], surface: "hard", daysAgo: 40 }),
  ];
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getPlayerGames: jest.fn(() => Promise.resolve(games)),
    getRankings: jest.fn(() => Promise.resolve([])),
    getGameStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  const profile = await getOrBuildPlayerProfile({ playerId: 10, playerName: "X", surface: "Dur", apiKey: KEY });
  expect(profile.matchesRecent14d).toBe(2);
});

test("classement réel trouvé par nom dans le classement ATP", async () => {
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getPlayerGames: jest.fn(() => Promise.resolve([])),
    getRankings: jest.fn((tour) => Promise.resolve(tour === "ATP" ? [{ rank: 4, player: { name: "Novak Djokovic" } }] : [])),
    getGameStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  const profile = await getOrBuildPlayerProfile({ playerId: 10, playerName: "Novak Djokovic", surface: "Dur", apiKey: KEY });
  expect(profile.ranking).toBe(4);
});

test("appels rapprochés pour le MÊME joueur/surface ne déclenchent qu'un seul calcul réel", async () => {
  const getPlayerGames = jest.fn(() => Promise.resolve([]));
  jest.doMock("../lib/sports/tennis/provider", () => ({
    getPlayerGames, getRankings: jest.fn(() => Promise.resolve([])), getGameStatistics: jest.fn(() => Promise.resolve([])),
  }));
  const { getOrBuildPlayerProfile } = await import("../lib/sports/tennis/statProfiles.js");
  await Promise.all([
    getOrBuildPlayerProfile({ playerId: 10, playerName: "X", surface: "Dur", apiKey: KEY }),
    getOrBuildPlayerProfile({ playerId: 10, playerName: "X", surface: "Dur", apiKey: KEY }),
  ]);
  expect(getPlayerGames).toHaveBeenCalledTimes(1);
});
