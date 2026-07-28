/**
 * lib/teamStatProfiles.js — BLOC 1 : profil statistique RÉEL par équipe, calculé à
 * partir de ses derniers matchs réellement joués (API-Football), avec répartition
 * domicile/extérieur — jamais une constante partagée entre équipes ou entre matchs
 * (contrairement à lib/pronostic.js, qui reste inchangé par ce bloc).
 */
const AF_KEY = "test-api-football-key";

beforeEach(() => {
  jest.resetModules();
});

// Simule la table team_stat_profiles en mémoire, assez fidèle à supabase-js pour
// exercer la vraie logique de lib/teamStatProfiles.js (select/eq/neq/maybeSingle,
// upsert par team_key).
function makeSupabaseMock(rows) {
  return {
    getSupabaseAdmin: () => ({
      from: (table) => {
        if (table !== "team_stat_profiles") throw new Error(`table inattendue : ${table}`);
        return {
          upsert: (row) => {
            const idx = rows.findIndex((r) => r.team_key === row.team_key);
            if (idx >= 0) rows[idx] = { ...row };
            else rows.push({ ...row });
            return Promise.resolve({ error: null });
          },
          select: () => {
            const filters = { eq: [], neq: [] };
            const builder = {
              eq: (col, val) => { filters.eq.push([col, val]); return builder; },
              neq: (col, val) => { filters.neq.push([col, val]); return builder; },
              maybeSingle: () => {
                const matches = rows.filter(
                  (r) => filters.eq.every(([c, v]) => r[c] === v) && filters.neq.every(([c, v]) => r[c] !== v)
                );
                return Promise.resolve({ data: matches[0] || null, error: null });
              },
              then: (resolve) => {
                const matches = rows.filter(
                  (r) => filters.eq.every(([c, v]) => r[c] === v) && filters.neq.every(([c, v]) => r[c] !== v)
                );
                return Promise.resolve({ data: matches, error: null }).then(resolve);
              },
            };
            return builder;
          },
        };
      },
    }),
  };
}

function fixtureEntry(id, { homeId, awayId, homeGoals, awayGoals, status = "FT" }) {
  return {
    fixture: { id, date: new Date().toISOString(), status: { short: status } },
    teams: { home: { id: homeId, name: `Team ${homeId}` }, away: { id: awayId, name: `Team ${awayId}` } },
    goals: { home: homeGoals, away: awayGoals },
  };
}

function statsRow(homeId, awayId, home, away) {
  const toStats = (s) => [
    { type: "Corner Kicks", value: s.corners },
    { type: "Offsides", value: s.offsides },
    { type: "Fouls", value: s.fouls },
    { type: "Total Shots", value: s.shots },
    { type: "Shots on Goal", value: s.shotsOnTarget },
    { type: "Yellow Cards", value: s.yellow },
    { type: "Red Cards", value: s.red },
  ];
  return [
    { team: { id: homeId }, statistics: toStats(home) },
    { team: { id: awayId }, statistics: toStats(away) },
  ];
}

// Fixture Real Madrid (id 200) : 1 match à domicile (id 101 vs 201), 1 à l'extérieur
// (id 102 vs 202) — chiffres volontairement différents entre les deux pour vérifier
// que le profil domicile diffère du profil extérieur.
function mockRealMadridRoutes() {
  return jest.fn((url) => {
    if (url.includes("/teams?search=")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 200, name: "Real Madrid" } }] }) });
    }
    if (url.includes("/fixtures?team=200")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: [
              fixtureEntry(101, { homeId: 200, awayId: 201, homeGoals: 3, awayGoals: 1 }),
              fixtureEntry(102, { homeId: 202, awayId: 200, homeGoals: 0, awayGoals: 2 }),
            ],
          }),
      });
    }
    if (url.includes("/fixtures/statistics?fixture=101")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: statsRow(
              200, 201,
              { corners: 8, offsides: 3, fouls: 9, shots: 16, shotsOnTarget: 7, yellow: 1, red: 0 },
              { corners: 2, offsides: 1, fouls: 14, shots: 6, shotsOnTarget: 2, yellow: 4, red: 1 }
            ),
          }),
      });
    }
    if (url.includes("/fixtures/statistics?fixture=102")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: statsRow(
              202, 200,
              { corners: 3, offsides: 2, fouls: 11, shots: 5, shotsOnTarget: 2, yellow: 3, red: 0 },
              { corners: 9, offsides: 2, fouls: 8, shots: 14, shotsOnTarget: 6, yellow: 1, red: 0 }
            ),
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

// Fixture Barcelone (id 300), chiffres nettement différents de Real Madrid ci-dessus,
// pour vérifier que deux équipes n'ont jamais le même profil.
function mockBarcelonaRoutes() {
  return jest.fn((url) => {
    if (url.includes("/teams?search=")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 300, name: "Barcelona" } }] }) });
    }
    if (url.includes("/fixtures?team=300")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: [
              fixtureEntry(301, { homeId: 300, awayId: 401, homeGoals: 5, awayGoals: 0 }),
              fixtureEntry(302, { homeId: 402, awayId: 300, homeGoals: 1, awayGoals: 1 }),
            ],
          }),
      });
    }
    if (url.includes("/fixtures/statistics?fixture=301")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: statsRow(
              300, 401,
              { corners: 11, offsides: 5, fouls: 6, shots: 20, shotsOnTarget: 9, yellow: 0, red: 0 },
              { corners: 1, offsides: 0, fouls: 16, shots: 3, shotsOnTarget: 1, yellow: 5, red: 1 }
            ),
          }),
      });
    }
    if (url.includes("/fixtures/statistics?fixture=302")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: statsRow(
              402, 300,
              { corners: 4, offsides: 2, fouls: 10, shots: 9, shotsOnTarget: 3, yellow: 2, red: 0 },
              { corners: 4, offsides: 2, fouls: 10, shots: 9, shotsOnTarget: 3, yellow: 2, red: 0 }
            ),
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

describe("getOrRefreshTeamProfile — calcul RÉEL à partir des derniers matchs (jamais une constante partagée)", () => {
  test("calcule les vraies moyennes buts/corners/tirs/fautes/hors-jeu/cartons à partir des matchs réellement joués", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = mockRealMadridRoutes();

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(profile.available).toBe(true);
    expect(profile.matchesUsed).toBe(2);
    // (3 + 2) / 2 = 2.5 buts marqués en moyenne, vraie moyenne, pas une valeur ronde arbitraire.
    expect(profile.overall.goalsFor).toEqual({ value: 2.5, estimated: false, sampleSize: 2, available: true });
    expect(profile.overall.goalsAgainst).toEqual({ value: 0.5, estimated: false, sampleSize: 2, available: true });
    // Corners obtenus : domicile (8) puis extérieur (9) -> moyenne 8.5.
    expect(profile.overall.cornersFor.value).toBe(8.5);
    expect(profile.overall.cornersAgainst.value).toBe(2.5);
  });

  test("le profil domicile diffère du profil extérieur pour une même équipe", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = mockRealMadridRoutes();

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(profile.home.goalsFor.value).not.toBe(profile.away.goalsFor.value);
    expect(profile.home.cornersFor.value).not.toBe(profile.away.cornersFor.value);
    expect(profile.home).toEqual({
      goalsFor: { value: 3, estimated: false, sampleSize: 1, available: true },
      goalsAgainst: { value: 1, estimated: false, sampleSize: 1, available: true },
      cornersFor: { value: 8, estimated: false, sampleSize: 1, available: true },
      cornersAgainst: { value: 2, estimated: false, sampleSize: 1, available: true },
      shots: { value: 16, estimated: false, sampleSize: 1, available: true },
      shotsOnTarget: { value: 7, estimated: false, sampleSize: 1, available: true },
      foulsCommitted: { value: 9, estimated: false, sampleSize: 1, available: true },
      foulsSuffered: { value: 14, estimated: false, sampleSize: 1, available: true },
      touches: { value: null, estimated: true, sampleSize: 0, available: false },
      offsides: { value: 3, estimated: false, sampleSize: 1, available: true },
      yellowCards: { value: 1, estimated: false, sampleSize: 1, available: true },
      redCards: { value: 0, estimated: false, sampleSize: 1, available: true },
    });
    expect(profile.away.goalsFor.value).toBe(2);
    expect(profile.away.cornersFor.value).toBe(9);
  });

  test("deux équipes différentes n'ont jamais un profil identique", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");

    global.fetch = mockRealMadridRoutes();
    const madrid = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    global.fetch = mockBarcelonaRoutes();
    const barcelona = await getOrRefreshTeamProfile({ teamName: "Barcelona", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(madrid.overall).not.toEqual(barcelona.overall);
    expect(madrid.home).not.toEqual(barcelona.home);
    expect(madrid.away).not.toEqual(barcelona.away);
    expect(madrid.overall.goalsFor.value).not.toBe(barcelona.overall.goalsFor.value);
    expect(madrid.overall.cornersFor.value).not.toBe(barcelona.overall.cornersFor.value);
  });

  test("« touches » reste toujours indisponible (available: false, jamais une valeur inventée) : aucune source connectée ne la fournit", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = mockRealMadridRoutes();

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    for (const split of [profile.overall, profile.home, profile.away]) {
      expect(split.touches).toEqual({ value: null, estimated: true, sampleSize: 0, available: false });
    }
  });

  test("la 1ère mi-temps reste structurée mais indisponible pour l'instant (aucune source ne la fournit), jamais une donnée inventée", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = mockRealMadridRoutes();

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(Object.keys(profile.firstHalf).sort()).toEqual(
      ["cornersAgainst", "cornersFor", "foulsCommitted", "foulsSuffered", "goalsAgainst", "goalsFor", "offsides", "touches"].sort()
    );
    for (const field of Object.values(profile.firstHalf)) {
      expect(field).toEqual({ value: null, estimated: true, sampleSize: 0, available: false });
    }
  });

  test("un champ totalement absent pour une équipe retombe sur la moyenne (réelle) des autres équipes de sa compétition, marquée « estimated »", async () => {
    // Pré-remplit la table avec deux profils réels de la même compétition, pour servir
    // de moyenne de repli à une équipe dont les statistiques détaillées manquent.
    const rows = [
      {
        team_key: "teamwithreal1", team_name: "Team With Real 1", competition_code: "PD",
        matches_used: 1, sample_fixture_ids: [1],
        overall: { cornersFor: { value: 10, estimated: false, sampleSize: 1, available: true } },
        home: {}, away: {}, first_half: {}, computed_at: new Date().toISOString(),
      },
      {
        team_key: "teamwithreal2", team_name: "Team With Real 2", competition_code: "PD",
        matches_used: 1, sample_fixture_ids: [2],
        overall: { cornersFor: { value: 6, estimated: false, sampleSize: 1, available: true } },
        home: {}, away: {}, first_half: {}, computed_at: new Date().toISOString(),
      },
    ];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));

    global.fetch = jest.fn((url) => {
      if (url.includes("/teams?search=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 999, name: "No Stats FC" } }] }) });
      }
      if (url.includes("/fixtures?team=999")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: [fixtureEntry(501, { homeId: 999, awayId: 998, homeGoals: 1, awayGoals: 0 })] }),
        });
      }
      if (url.includes("/fixtures/statistics?fixture=501")) {
        // Aucune statistique détaillée disponible pour ce match (ligue mal couverte).
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      }
      return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
    });

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "No Stats FC", competitionCode: "PD", apiFootballKey: AF_KEY });

    // Moyenne des deux profils réels de la compétition : (10 + 6) / 2 = 8, jamais une
    // constante codée en dur.
    expect(profile.overall.cornersFor).toEqual({ value: 8, estimated: true, sampleSize: 0, available: true });
    // Les buts, eux, restent réels (toujours fournis par le fixture lui-même).
    expect(profile.overall.goalsFor).toEqual({ value: 1, estimated: false, sampleSize: 1, available: true });
  });

  test("sans aucune donnée réelle ni moyenne de compétition disponible, le champ reste honnêtement indisponible (jamais une valeur inventée)", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));

    global.fetch = jest.fn((url) => {
      if (url.includes("/teams?search=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 999, name: "No Stats FC" } }] }) });
      }
      if (url.includes("/fixtures?team=999")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: [fixtureEntry(501, { homeId: 999, awayId: 998, homeGoals: 1, awayGoals: 0 })] }),
        });
      }
      if (url.includes("/fixtures/statistics?fixture=501")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      }
      return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
    });

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "No Stats FC", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(profile.overall.cornersFor).toEqual({ value: null, estimated: true, sampleSize: 0, available: false });
  });

  test("un profil récent (< 24h) est resservi tel quel, sans aucun nouvel appel API", async () => {
    const rows = [
      {
        team_key: "realmadrid", team_name: "Real Madrid", competition_code: "PD",
        matches_used: 2, sample_fixture_ids: [101, 102],
        overall: { goalsFor: { value: 2.5, estimated: false, sampleSize: 2, available: true } },
        home: {}, away: {}, first_half: {}, computed_at: new Date().toISOString(),
      },
    ];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(profile.overall.goalsFor.value).toBe(2.5);
  });

  test("un profil périmé (> 24h) déclenche un vrai recalcul", async () => {
    const oldDate = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const rows = [
      {
        team_key: "realmadrid", team_name: "Real Madrid", competition_code: "PD",
        matches_used: 1, sample_fixture_ids: [1],
        overall: { goalsFor: { value: 99, estimated: false, sampleSize: 1, available: true } },
        home: {}, away: {}, first_half: {}, computed_at: oldDate,
      },
    ];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = mockRealMadridRoutes();

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    // Recalculé à partir des vrais matchs mockés (2.5), plus l'ancienne valeur périmée (99).
    expect(profile.overall.goalsFor.value).toBe(2.5);
    expect(rows.find((r) => r.team_key === "realmadrid").matches_used).toBe(2);
  });

  test("sans clé API-Football et sans profil connu, honnêtement indisponible", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = jest.fn();

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: null });

    expect(profile.available).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("sans clé API-Football mais avec un profil déjà connu (même périmé), le dernier profil connu est resservi plutôt que de disparaître", async () => {
    const oldDate = new Date(Date.now() - 999 * 3600 * 1000).toISOString();
    const rows = [
      {
        team_key: "realmadrid", team_name: "Real Madrid", competition_code: "PD",
        matches_used: 2, sample_fixture_ids: [101, 102],
        overall: { goalsFor: { value: 2.5, estimated: false, sampleSize: 2, available: true } },
        home: {}, away: {}, first_half: {}, computed_at: oldDate,
      },
    ];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = jest.fn();

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: null });

    expect(profile.available).toBe(true);
    expect(profile.overall.goalsFor.value).toBe(2.5);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("un match sans score final exploitable est ignoré (jamais une donnée à moitié fiable)", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = jest.fn((url) => {
      if (url.includes("/teams?search=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 200, name: "Real Madrid" } }] }) });
      }
      if (url.includes("/fixtures?team=200")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              response: [
                fixtureEntry(101, { homeId: 200, awayId: 201, homeGoals: 3, awayGoals: 1 }),
                // Score manquant (donnée corrompue/API défaillante) : doit être ignoré.
                fixtureEntry(103, { homeId: 200, awayId: 203, homeGoals: null, awayGoals: null }),
              ],
            }),
        });
      }
      if (url.includes("/fixtures/statistics?fixture=101")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              response: statsRow(
                200, 201,
                { corners: 8, offsides: 3, fouls: 9, shots: 16, shotsOnTarget: 7, yellow: 1, red: 0 },
                { corners: 2, offsides: 1, fouls: 14, shots: 6, shotsOnTarget: 2, yellow: 4, red: 1 }
              ),
            }),
        });
      }
      return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
    });

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(profile.matchesUsed).toBe(1);
    expect(profile.overall.goalsFor.value).toBe(3);
  });

  test("ne prend en compte que les matchs réellement terminés (ignore un match programmé remonté par erreur)", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = jest.fn((url) => {
      if (url.includes("/teams?search=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 200, name: "Real Madrid" } }] }) });
      }
      if (url.includes("/fixtures?team=200")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              response: [
                fixtureEntry(101, { homeId: 200, awayId: 201, homeGoals: 3, awayGoals: 1, status: "FT" }),
                fixtureEntry(104, { homeId: 200, awayId: 204, homeGoals: null, awayGoals: null, status: "NS" }),
              ],
            }),
        });
      }
      if (url.includes("/fixtures/statistics?fixture=101")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              response: statsRow(
                200, 201,
                { corners: 8, offsides: 3, fouls: 9, shots: 16, shotsOnTarget: 7, yellow: 1, red: 0 },
                { corners: 2, offsides: 1, fouls: 14, shots: 6, shotsOnTarget: 2, yellow: 4, red: 1 }
              ),
            }),
        });
      }
      return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
    });

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(profile.matchesUsed).toBe(1);
  });

  test("moins de 10 matchs disponibles : le nombre réellement utilisé est noté (jamais complété artificiellement)", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = mockRealMadridRoutes(); // seulement 2 matchs mockés
    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Real Madrid", competitionCode: "PD", apiFootballKey: AF_KEY });
    expect(profile.matchesUsed).toBe(2);
    expect(profile.matchesUsed).toBeLessThan(10);
  });

  test("équipe introuvable côté API-Football et sans profil connu : honnêtement indisponible", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Équipe Inconnue", competitionCode: "PD", apiFootballKey: AF_KEY });

    expect(profile.available).toBe(false);
  });
});
