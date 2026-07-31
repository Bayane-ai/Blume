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

// `daysAgo` : les tests fixent des dates EXPLICITES (jamais `new Date()` au moment de
// l'appel) pour que la pondération par récence (voir lib/teamStatProfiles.js,
// recencyWeight) reste déterministe d'une exécution à l'autre — 0 = aujourd'hui, plus
// grand = plus ancien.
function fixtureEntry(id, { homeId, awayId, homeGoals, awayGoals, status = "FT", daysAgo = 0 }) {
  return {
    fixture: { id, date: new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(), status: { short: status } },
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
              fixtureEntry(101, { homeId: 200, awayId: 201, homeGoals: 3, awayGoals: 1, daysAgo: 7 }),
              fixtureEntry(102, { homeId: 202, awayId: 200, homeGoals: 0, awayGoals: 2, daysAgo: 1 }),
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
              fixtureEntry(301, { homeId: 300, awayId: 401, homeGoals: 5, awayGoals: 0, daysAgo: 7 }),
              fixtureEntry(302, { homeId: 402, awayId: 300, homeGoals: 1, awayGoals: 2, daysAgo: 1 }),
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
    // Moyenne PONDÉRÉE par récence (match le plus ancien = poids 1, le plus récent =
    // poids 2, voir recencyWeight) : (3*1 + 2*2) / (1+2) = 7/3 ≈ 2,33 — jamais une
    // simple moyenne arithmétique (2,5), qui donnerait autant de poids au match le
    // plus ancien qu'au plus récent.
    expect(profile.overall.goalsFor).toEqual({ value: 2.33, estimated: false, sampleSize: 2, available: true });
    expect(profile.overall.goalsAgainst).toEqual({ value: 0.33, estimated: false, sampleSize: 2, available: true });
    // Corners obtenus : domicile (8, poids 1) puis extérieur (9, poids 2) -> (8+18)/3 ≈ 8,67.
    expect(profile.overall.cornersFor.value).toBe(8.67);
    expect(profile.overall.cornersAgainst.value).toBe(2.67);
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
      // PROMPT 1 : taux de conversion réel de ce match (3 buts / 16 tirs) ; clean
      // sheet raté (1 but encaissé) ; possession jamais fournie par ce fixture mock
      // (aucun type "Ball Possession" dans statsRow) -> honnêtement indisponible.
      conversionRate: { value: 0.19, estimated: false, sampleSize: 1, available: true },
      cleanSheetRate: { value: 0, estimated: false, sampleSize: 1, available: true },
      possession: { value: null, estimated: true, sampleSize: 0, available: false },
    });
    expect(profile.away.goalsFor.value).toBe(2);
    expect(profile.away.cornersFor.value).toBe(9);
  });

  test("PROMPT 1 — un match plus récent pèse plus qu'un match ancien dans la moyenne", async () => {
    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    // 3 matchs à domicile, même adversaire (poids d'adversité neutre, pas de token
    // football-data.org ici) : seule la récence doit faire varier la moyenne pondérée
    // par rapport à la simple moyenne arithmétique (2/3 ≈ 0,67).
    global.fetch = jest.fn((url) => {
      if (url.includes("/teams?search=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 700, name: "Recency FC" } }] }) });
      }
      if (url.includes("/fixtures?team=700")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              response: [
                fixtureEntry(801, { homeId: 700, awayId: 601, homeGoals: 0, awayGoals: 1, daysAgo: 20 }), // le plus ancien
                fixtureEntry(802, { homeId: 700, awayId: 602, homeGoals: 0, awayGoals: 1, daysAgo: 10 }),
                fixtureEntry(803, { homeId: 700, awayId: 603, homeGoals: 3, awayGoals: 1, daysAgo: 1 }), // le plus récent
              ],
            }),
        });
      }
      if (url.includes("/fixtures/statistics?")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      }
      return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
    });

    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profile = await getOrRefreshTeamProfile({ teamName: "Recency FC", competitionCode: "PD", apiFootballKey: AF_KEY });

    // Poids 1/2/3 (du plus ancien au plus récent) : (0*1 + 0*2 + 3*3) / 6 = 9/6 = 1,5.
    // Une simple moyenne arithmétique aurait donné (0+0+3)/3 = 1.
    expect(profile.overall.goalsFor.value).toBe(1.5);
  });

  test("PROMPT 1 — un adversaire mieux classé (classement football-data.org) fait peser CE match plus lourd", async () => {
    // Deux matchs à des buts DIFFÉRENTS (1 but contre le 1er du classement, plus
    // ancien ; 3 buts contre le dernier du classement, plus récent) : sans classement
    // exploitable, seule la récence pèse -> (1*1 + 3*2)/3 = 7/3 ≈ 2,33. Avec le
    // classement, le match contre le 1er (adversaire fort) pèse relativement plus —
    // preuve réelle que le niveau d'adversité influence le calcul.
    function mockFetch() {
      return jest.fn((url) => {
        if (url.includes("/teams?search=")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 900, name: "Opponent Aware FC" } }] }) });
        }
        if (url.includes("/fixtures?team=900")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                response: [
                  fixtureEntry(901, { homeId: 900, awayId: 10, homeGoals: 1, awayGoals: 0, daysAgo: 10 }), // vs 1er du classement
                  fixtureEntry(902, { homeId: 900, awayId: 20, homeGoals: 3, awayGoals: 0, daysAgo: 1 }), // vs dernier du classement
                ],
              }),
          });
        }
        if (url.includes("/fixtures/statistics?")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
        }
        if (url.includes("/competitions/PD/standings")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                standings: [
                  {
                    table: [
                      { position: 1, team: { id: 10, name: "Team 10" } },
                      { position: 2, team: { id: 11, name: "Team 11" } },
                      { position: 3, team: { id: 12, name: "Team 12" } },
                      { position: 4, team: { id: 20, name: "Team 20" } },
                    ],
                  },
                ],
              }),
          });
        }
        return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
      });
    }

    const rows = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows));
    global.fetch = mockFetch();
    const { getOrRefreshTeamProfile } = await import("../lib/teamStatProfiles.js");
    const profileWithStandings = await getOrRefreshTeamProfile({
      teamName: "Opponent Aware FC", competitionCode: "PD", apiFootballKey: AF_KEY, token: "fd-token",
    });
    // Poids : vs 1er (position 1/4, multiplicateur 1.3) × récence 1 = 1.3 ;
    // vs dernier (position 4/4, multiplicateur 0.7) × récence 2 = 1.4.
    // (1*1.3 + 3*1.4) / (1.3+1.4) = 5.5/2.7 ≈ 2.04.
    expect(profileWithStandings.overall.goalsFor.value).toBe(2.04);

    jest.resetModules();
    const rows2 = [];
    jest.doMock("../lib/supabaseAdmin", () => makeSupabaseMock(rows2));
    global.fetch = mockFetch();
    const { getOrRefreshTeamProfile: getOrRefreshTeamProfile2 } = await import("../lib/teamStatProfiles.js");
    // Sans token football-data.org : poids d'adversité neutre partout, seule la
    // récence compte -> (1*1 + 3*2)/3 = 7/3 ≈ 2,33.
    const profileWithoutStandings = await getOrRefreshTeamProfile2({
      teamName: "Opponent Aware FC", competitionCode: "PD", apiFootballKey: AF_KEY, token: null,
    });
    expect(profileWithoutStandings.overall.goalsFor.value).toBe(2.33);

    expect(profileWithStandings.overall.goalsFor.value).not.toBe(profileWithoutStandings.overall.goalsFor.value);
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

    // Recalculé à partir des vrais matchs mockés (moyenne pondérée par récence, 2.33),
    // pas l'ancienne valeur périmée (99).
    expect(profile.overall.goalsFor.value).toBe(2.33);
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
