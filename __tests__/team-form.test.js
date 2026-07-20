/**
 * lib/teamForm.js : forme récente réelle d'un club (derniers matchs joués, toutes
 * compétitions confondues) — la base de calcul des pronostics (voir
 * pages/api/analyze.js). Vérifie le calcul buts marqués/encaissés ET la chaîne de
 * forme ("WWDLW", du plus ancien au plus récent, comme football-data.org).
 */
const TOKEN = "test-token";

beforeEach(() => {
  jest.resetModules();
});

function match(teamId, opponentId, isHome, gf, ga, daysAgo) {
  return {
    utcDate: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    homeTeam: { id: isHome ? teamId : opponentId },
    awayTeam: { id: isHome ? opponentId : teamId },
    score: { fullTime: { home: isHome ? gf : ga, away: isHome ? ga : gf } },
  };
}

test("calcule buts marqués/encaissés à domicile ET à l'extérieur, et une chaîne de forme du plus ancien au plus récent", async () => {
  global.fetch = jest.fn((url) => {
    expect(url).toContain("/teams/42/matches");
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          matches: [
            match(42, 1, true, 2, 0, 5), // le plus ancien : victoire 2-0 à domicile
            match(42, 2, false, 1, 1, 4), // nul 1-1 à l'extérieur
            match(42, 3, true, 0, 3, 3), // défaite 0-3 à domicile
            match(42, 4, false, 2, 1, 2), // victoire 2-1 à l'extérieur
            match(42, 5, true, 1, 0, 1), // le plus récent : victoire 1-0 à domicile
          ],
        }),
    });
  });

  const { getTeamRecentForm } = await import("../lib/teamForm.js");
  const stats = await getTeamRecentForm(42, TOKEN);

  expect(stats.playedGames).toBe(5);
  expect(stats.goalsFor).toBe(2 + 1 + 0 + 2 + 1);
  expect(stats.goalsAgainst).toBe(0 + 1 + 3 + 1 + 0);
  expect(stats.form).toBe("WDLWW");

  // Répartition domicile/extérieur (lib/pronostic.js s'en sert pour la vraie moyenne
  // par lieu) : 3 matchs à domicile (2-0, 0-3, 1-0) et 2 à l'extérieur (1-1, 2-1),
  // jamais mélangés.
  expect(stats.homePlayedGames).toBe(3);
  expect(stats.homeGoalsFor).toBe(2 + 0 + 1);
  expect(stats.homeGoalsAgainst).toBe(0 + 3 + 0);
  expect(stats.awayPlayedGames).toBe(2);
  expect(stats.awayGoalsFor).toBe(1 + 2);
  expect(stats.awayGoalsAgainst).toBe(1 + 1);
});

test("ne garde que les 5 derniers résultats dans la chaîne de forme, même si plus de matchs sont fournis", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          matches: Array.from({ length: 8 }, (_, i) => match(42, 900 + i, true, i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 0 : 1, 8 - i)),
        }),
    })
  );

  const { getTeamRecentForm } = await import("../lib/teamForm.js");
  const stats = await getTeamRecentForm(42, TOKEN);

  expect(stats.playedGames).toBe(8);
  expect(stats.form).toHaveLength(5);
});

test("ignore les matchs sans score exploitable, sans planter", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          matches: [
            { utcDate: new Date().toISOString(), homeTeam: { id: 42 }, awayTeam: { id: 1 }, score: { fullTime: { home: null, away: null } } },
            match(42, 2, true, 3, 1, 1),
          ],
        }),
    })
  );

  const { getTeamRecentForm } = await import("../lib/teamForm.js");
  const stats = await getTeamRecentForm(42, TOKEN);

  expect(stats.playedGames).toBe(1);
  expect(stats.form).toBe("W");
});

test("aucun match exploitable : renvoie null (le repli classement/estimation prend le relais)", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) }));

  const { getTeamRecentForm } = await import("../lib/teamForm.js");
  const stats = await getTeamRecentForm(42, TOKEN);

  expect(stats).toBeNull();
});

test("des demandes concurrentes pour la même équipe ne déclenchent qu'un seul appel réel à l'API", async () => {
  const fetchMock = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [match(42, 1, true, 1, 0, 1)] }) })
  );
  global.fetch = fetchMock;

  const { getTeamRecentForm } = await import("../lib/teamForm.js");
  await Promise.all([getTeamRecentForm(42, TOKEN), getTeamRecentForm(42, TOKEN), getTeamRecentForm(42, TOKEN)]);

  expect(fetchMock).toHaveBeenCalledTimes(1);
});
