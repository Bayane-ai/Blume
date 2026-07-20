/**
 * lib/apiFootball.js — source des événements live (buts/cartons/remplacements), en
 * complément de football-data.org qui ne les fournit pas. Vérifie : la mise en
 * correspondance des équipes entre les deux API (noms différents, ids différents), la
 * traduction du format d'événement brut vers celui attendu par MatchTimeline, et le
 * partage des appels en amont (cache + déduplication) pour ne pas épuiser le quota
 * quotidien (100 requêtes/jour sur le plan gratuit API-Football).
 */
const TOKEN = "test-api-football-key";

beforeEach(() => {
  jest.resetModules();
});

describe("normalizeTeamName", () => {
  test("ignore casse, accents et suffixes de club (FC/CF/AC/SC...) pour comparer deux noms d'équipe", async () => {
    const { normalizeTeamName } = await import("../lib/apiFootball.js");
    expect(normalizeTeamName("Paris Saint Germain")).toBe(normalizeTeamName("Paris Saint-Germain"));
    expect(normalizeTeamName("Atlético Madrid")).toBe(normalizeTeamName("Atletico Madrid"));
    expect(normalizeTeamName("Arsenal FC")).toBe(normalizeTeamName("Arsenal"));
  });
});

describe("findLiveFixtureByTeams", () => {
  test("retrouve le bon match API-Football à partir des noms d'équipe football-data.org", async () => {
    const { findLiveFixtureByTeams } = await import("../lib/apiFootball.js");
    const fixtures = [
      { fixture: { id: 1 }, teams: { home: { id: 100, name: "Real Madrid" }, away: { id: 101, name: "FC Barcelona" } } },
      { fixture: { id: 2 }, teams: { home: { id: 200, name: "Arsenal" }, away: { id: 201, name: "Chelsea" } } },
    ];
    const found = findLiveFixtureByTeams(fixtures, "Arsenal FC", "Chelsea FC");
    expect(found.fixture.id).toBe(2);
  });

  test("renvoie null si aucun match en direct ne correspond (jamais un match inventé)", async () => {
    const { findLiveFixtureByTeams } = await import("../lib/apiFootball.js");
    const fixtures = [
      { fixture: { id: 1 }, teams: { home: { id: 100, name: "Real Madrid" }, away: { id: 101, name: "FC Barcelona" } } },
    ];
    expect(findLiveFixtureByTeams(fixtures, "Arsenal FC", "Chelsea FC")).toBeNull();
  });
});

describe("mapApiFootballEvents", () => {
  const ctx = { fixtureHomeId: 200, homeTeamId: "10", awayTeamId: "11" };

  test("traduit but, carton et remplacement vers le format attendu par MatchTimeline, avec l'id football-data.org (pas celui d'API-Football)", async () => {
    const { mapApiFootballEvents } = await import("../lib/apiFootball.js");
    const raw = [
      { time: { elapsed: 23 }, team: { id: 200 }, player: { id: 1, name: "Bukayo Saka" }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 40 }, team: { id: 201 }, player: { id: 2, name: "Reece James" }, type: "Card", detail: "Yellow Card" },
      { time: { elapsed: 60 }, team: { id: 200 }, player: { id: 3, name: "Eddie Nketiah" }, assist: { id: 4, name: "Gabriel Jesus" }, type: "subst", detail: "Substitution 1" },
    ];
    const events = mapApiFootballEvents(raw, ctx);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ minute: 23, type: "GOAL", teamId: "10", player: { name: "Bukayo Saka" } });
    expect(events[1]).toMatchObject({ minute: 40, type: "YELLOW_CARD", teamId: "11" });
    expect(events[2]).toMatchObject({
      minute: 60, type: "SUBSTITUTION", teamId: "10",
      playerOut: { name: "Eddie Nketiah" }, playerIn: { name: "Gabriel Jesus" },
    });
  });

  test("calcule le score après chaque but à partir des vrais buts reçus (jamais une valeur inventée)", async () => {
    const { mapApiFootballEvents } = await import("../lib/apiFootball.js");
    const raw = [
      { time: { elapsed: 10 }, team: { id: 200 }, player: { name: "A" }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 30 }, team: { id: 201 }, player: { name: "B" }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 50 }, team: { id: 200 }, player: { name: "C" }, type: "Goal", detail: "Normal Goal" },
    ];
    const events = mapApiFootballEvents(raw, ctx);
    expect(events[0].scoreAfter).toEqual({ home: 1, away: 0 });
    expect(events[1].scoreAfter).toEqual({ home: 1, away: 1 });
    expect(events[2].scoreAfter).toEqual({ home: 2, away: 1 });
  });

  test("un but contre son camp est crédité à l'équipe adverse dans le score", async () => {
    const { mapApiFootballEvents } = await import("../lib/apiFootball.js");
    // L'équipe domicile (200) marque contre son propre camp : le but doit compter pour
    // l'extérieur, pas pour le domicile.
    const raw = [{ time: { elapsed: 15 }, team: { id: 200 }, player: { name: "D" }, type: "Goal", detail: "Own Goal" }];
    const events = mapApiFootballEvents(raw, ctx);
    expect(events[0].scoreAfter).toEqual({ home: 0, away: 1 });
  });

  test("ignore un penalty manqué (pas un vrai but) et les types d'événement non gérés (ex: VAR)", async () => {
    const { mapApiFootballEvents } = await import("../lib/apiFootball.js");
    const raw = [
      { time: { elapsed: 20 }, team: { id: 200 }, player: { name: "E" }, type: "Goal", detail: "Missed Penalty" },
      { time: { elapsed: 25 }, team: { id: 200 }, type: "Var", detail: "Goal Disallowed" },
    ];
    expect(mapApiFootballEvents(raw, ctx)).toHaveLength(0);
  });
});

describe("getFixtureStatistics / mapFixtureStatistics — vraies statistiques FINALES (compte-rendu de fin de match uniquement)", () => {
  test("sans clé API ou sans id de match, renvoie null sans jamais appeler l'API", async () => {
    const { getFixtureStatistics } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn();
    expect(await getFixtureStatistics(555, null)).toBeNull();
    expect(await getFixtureStatistics(null, TOKEN)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("interroge /fixtures/statistics?fixture=ID avec la vraie clé API", async () => {
    const { getFixtureStatistics } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn((url, opts) => {
      expect(url).toBe("https://v3.football.api-sports.io/fixtures/statistics?fixture=555");
      expect(opts.headers).toEqual({ "x-apisports-key": TOKEN });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    });
    global.fetch = fetchMock;
    await getFixtureStatistics(555, TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("plusieurs appels rapprochés pour le MÊME match ne déclenchent qu'un seul appel réel", async () => {
    const { getFixtureStatistics } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    global.fetch = fetchMock;
    await Promise.all([getFixtureStatistics(555, TOKEN), getFixtureStatistics(555, TOKEN)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("mapFixtureStatistics traduit corners/hors-jeu/fautes/tirs/cartons réels, home/away/total, en identifiant la bonne équipe à domicile", async () => {
    const { mapFixtureStatistics } = await import("../lib/apiFootball.js");
    const raw = [
      {
        team: { id: 101 }, // extérieur, volontairement en premier dans la réponse
        statistics: [
          { type: "Corner Kicks", value: 4 }, { type: "Offsides", value: 1 }, { type: "Fouls", value: 9 },
          { type: "Total Shots", value: "11" }, { type: "Yellow Cards", value: 2 }, { type: "Red Cards", value: null },
        ],
      },
      {
        team: { id: 100 }, // domicile
        statistics: [
          { type: "Corner Kicks", value: 9 }, { type: "Offsides", value: 3 }, { type: "Fouls", value: 8 },
          { type: "Total Shots", value: 15 }, { type: "Yellow Cards", value: 3 }, { type: "Red Cards", value: 1 },
        ],
      },
    ];
    const stats = mapFixtureStatistics(raw, 100);
    expect(stats.corners).toEqual({ home: 9, away: 4, total: 13 });
    expect(stats.offsides).toEqual({ home: 3, away: 1, total: 4 });
    expect(stats.fouls).toEqual({ home: 8, away: 9, total: 17 });
    expect(stats.shots).toEqual({ home: 15, away: 11, total: 26 });
    expect(stats.yellowCards).toEqual({ home: 3, away: 2, total: 5 });
    // Une valeur `null` (pas de carton rouge) est un vrai zéro, jamais une donnée manquante inventée.
    expect(stats.redCards).toEqual({ home: 1, away: 0, total: 1 });
  });

  test("mapFixtureStatistics renvoie null si la réponse n'a pas la forme attendue (pas les deux équipes)", async () => {
    const { mapFixtureStatistics } = await import("../lib/apiFootball.js");
    expect(mapFixtureStatistics([], 100)).toBeNull();
    expect(mapFixtureStatistics([{ team: { id: 100 }, statistics: [] }], 100)).toBeNull();
    expect(mapFixtureStatistics(null, 100)).toBeNull();
  });
});

describe("mapFixtureToLiveMatch / mapFixtureToLiveState — bloc 2 (liste live mondiale + repli score/minute)", () => {
  function rawFixture(overrides = {}) {
    return {
      fixture: { id: 12345, date: "2026-07-19T20:00:00Z", status: { short: "2H", elapsed: 63 }, venue: { name: "Old Trafford" }, referee: "M. Oliver" },
      league: { id: 71, name: "Brasileirão", logo: "https://logo/71.png" },
      teams: {
        home: { id: 111, name: "Flamengo", logo: "https://logo/home.png" },
        away: { id: 222, name: "Palmeiras", logo: "https://logo/away.png" },
      },
      goals: { home: 2, away: 1 },
      ...overrides,
    };
  }

  test("l'id du match et des équipes est préfixé 'af-' pour ne jamais coïncider avec un id football-data.org", async () => {
    const { mapFixtureToLiveMatch } = await import("../lib/apiFootball.js");
    const m = mapFixtureToLiveMatch(rawFixture());
    expect(m.id).toBe("af-12345");
    expect(m.homeTeam.id).toBe("af-111");
    expect(m.awayTeam.id).toBe("af-222");
    expect(m.competition.code).toBe("af-71");
  });

  test("traduit correctement équipes, score, minute et compétition, avec le vrai statut IN_PLAY", async () => {
    const { mapFixtureToLiveMatch } = await import("../lib/apiFootball.js");
    const m = mapFixtureToLiveMatch(rawFixture());
    expect(m.status).toBe("IN_PLAY");
    expect(m.minute).toBe(63);
    expect(m.homeTeam.name).toBe("Flamengo");
    expect(m.awayTeam.name).toBe("Palmeiras");
    expect(m.score.fullTime).toEqual({ home: 2, away: 1 });
    expect(m.competition.name).toBe("Brasileirão");
  });

  test("la mi-temps (HT) devient PAUSED, comme pour football-data.org", async () => {
    const { mapFixtureToLiveMatch } = await import("../lib/apiFootball.js");
    const m = mapFixtureToLiveMatch(rawFixture({ fixture: { ...rawFixture().fixture, status: { short: "HT", elapsed: 45 } } }));
    expect(m.status).toBe("PAUSED");
  });

  test("mapFixtureToLiveState renvoie le même format que lib/liveMatchCache.js (score/minute/statut/lieu/arbitre)", async () => {
    const { mapFixtureToLiveState } = await import("../lib/apiFootball.js");
    const state = mapFixtureToLiveState(rawFixture());
    expect(state).toEqual({
      status: "IN_PLAY", minute: 63,
      score: { fullTime: { home: 2, away: 1 } },
      venue: "Old Trafford",
      referees: [{ name: "M. Oliver" }],
    });
  });
});

describe("getAllLiveFixtures / getFixtureEvents — cache partagé et déduplication (quota quotidien limité)", () => {
  test("sans clé API, renvoie une liste vide sans jamais appeler l'API", async () => {
    const { getAllLiveFixtures } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn();
    expect(await getAllLiveFixtures(null)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("plusieurs appels rapprochés à getAllLiveFixtures ne déclenchent qu'un seul appel réel à l'API", async () => {
    const { getAllLiveFixtures } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    global.fetch = fetchMock;

    await Promise.all([getAllLiveFixtures(TOKEN), getAllLiveFixtures(TOKEN), getAllLiveFixtures(TOKEN)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v3.football.api-sports.io/fixtures?live=all");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "x-apisports-key": TOKEN });
  });

  test("getFixtureEvents renvoie null (pas un tableau vide) en cas d'échec réel de l'API — distinction importante avec 'aucun événement pour l'instant'", async () => {
    const { getFixtureEvents } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));
    expect(await getFixtureEvents(42, TOKEN)).toBeNull();
  });

  test("getFixtureEvents renvoie le tableau réel (même vide) quand l'API répond correctement", async () => {
    const { getFixtureEvents } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    expect(await getFixtureEvents(42, TOKEN)).toEqual([]);
  });

  test("plusieurs visiteurs suivant le même match ne déclenchent qu'un seul appel réel pour ses événements", async () => {
    const { getFixtureEvents } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ type: "Goal" }] }) }));
    global.fetch = fetchMock;

    await Promise.all([getFixtureEvents(99, TOKEN), getFixtureEvents(99, TOKEN), getFixtureEvents(99, TOKEN)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v3.football.api-sports.io/fixtures/events?fixture=99");
  });
});

describe("getFixturesByDate / mapFixtureToUpcomingMatch — couverture mondiale des matchs À VENIR (pas seulement le direct)", () => {
  test("sans clé API, renvoie une liste vide sans jamais appeler l'API", async () => {
    const { getFixturesByDate } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn();
    expect(await getFixturesByDate("2026-07-21", null)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("interroge /fixtures?date=... sans aucun filtre de ligue, pays ou saison — couverture mondiale", async () => {
    const { getFixturesByDate } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn((url, opts) => {
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe("https://v3.football.api-sports.io/fixtures");
      expect(parsed.searchParams.get("date")).toBe("2026-07-21");
      expect(parsed.searchParams.has("league")).toBe(false);
      expect(parsed.searchParams.has("country")).toBe(false);
      expect(opts.headers).toEqual({ "x-apisports-key": TOKEN });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    });
    global.fetch = fetchMock;

    await getFixturesByDate("2026-07-21", TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("plusieurs appels rapprochés pour la MÊME date ne déclenchent qu'un seul appel réel", async () => {
    const { getFixturesByDate } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    global.fetch = fetchMock;

    await Promise.all([
      getFixturesByDate("2026-07-21", TOKEN),
      getFixturesByDate("2026-07-21", TOKEN),
      getFixturesByDate("2026-07-21", TOKEN),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("deux dates différentes déclenchent bien deux appels distincts, chacun avec sa propre date", async () => {
    const { getFixturesByDate } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    global.fetch = fetchMock;

    await Promise.all([getFixturesByDate("2026-07-21", TOKEN), getFixturesByDate("2026-07-22", TOKEN)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const dates = fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get("date"));
    expect(dates.sort()).toEqual(["2026-07-21", "2026-07-22"]);
  });

  test("un échec réseau après un premier succès reprend la dernière liste connue pour cette date plutôt que de la faire disparaître", async () => {
    const { getFixturesByDate } = await import("../lib/apiFootball.js");
    const fixtures = [{ fixture: { id: 1 } }];
    let call = 0;
    global.fetch = jest.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: fixtures }) });
      return Promise.reject(new Error("Erreur réseau"));
    });

    const first = await getFixturesByDate("2026-07-21", TOKEN);
    expect(first).toEqual(fixtures);
  });

  test("mapFixtureToUpcomingMatch : id/équipes/compétition préfixés 'af-', statut SCHEDULED, aucun score ni minute inventés", async () => {
    const { mapFixtureToUpcomingMatch } = await import("../lib/apiFootball.js");
    const fixture = {
      fixture: { id: 999, date: "2026-07-25T18:00:00Z", status: { short: "NS" } },
      league: { id: 55, name: "Championnat U20", country: "Argentine", logo: "https://logo/55.png" },
      teams: {
        home: { id: 10, name: "Argentine U20", logo: "https://logo/home.png" },
        away: { id: 20, name: "Brésil U20", logo: "https://logo/away.png" },
      },
    };
    const m = mapFixtureToUpcomingMatch(fixture);
    expect(m.id).toBe("af-999");
    expect(m.status).toBe("SCHEDULED");
    expect(m.minute).toBeNull();
    expect(m.matchday).toBeNull();
    expect(m.utcDate).toBe("2026-07-25T18:00:00Z");
    expect(m.competition).toEqual({ code: "af-55", name: "Championnat U20", area: "Argentine", emblem: "https://logo/55.png" });
    expect(m.homeTeam).toEqual({ id: "af-10", name: "Argentine U20", crest: "https://logo/home.png" });
    expect(m.awayTeam).toEqual({ id: "af-20", name: "Brésil U20", crest: "https://logo/away.png" });
    expect(m.score.fullTime).toEqual({ home: null, away: null });
  });
});

describe("findApiFootballTeamId / getTeamCardProneness — joueurs susceptibles de prendre un carton (best-effort)", () => {
  test("sans clé API, renvoie null/liste vide sans jamais appeler l'API", async () => {
    const { findApiFootballTeamId, getTeamCardProneness } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn();
    expect(await findApiFootballTeamId("Arsenal FC", null)).toBeNull();
    expect(await getTeamCardProneness(42, null)).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("findApiFootballTeamId interroge /teams?search=... et retrouve l'équipe par son nom réel (accents/suffixes ignorés)", async () => {
    const { findApiFootballTeamId } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn((url) => {
      expect(url).toContain("/teams?search=");
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ response: [{ team: { id: 42, name: "Arsenal" } }] }),
      });
    });
    global.fetch = fetchMock;

    const teamId = await findApiFootballTeamId("Arsenal FC", TOKEN);
    expect(teamId).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("équipe introuvable dans les résultats de recherche : renvoie null plutôt qu'un id au hasard qui désignerait la mauvaise équipe", async () => {
    const { findApiFootballTeamId } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    expect(await findApiFootballTeamId("Équipe Inconnue FC", TOKEN)).toBeNull();
  });

  test("plusieurs recherches rapprochées pour la MÊME équipe ne déclenchent qu'un seul appel réel", async () => {
    const { findApiFootballTeamId } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [{ team: { id: 42, name: "Arsenal" } }] }) })
    );
    global.fetch = fetchMock;

    await Promise.all([findApiFootballTeamId("Arsenal FC", TOKEN), findApiFootballTeamId("Arsenal", TOKEN)]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // même équipe une fois normalisée
  });

  test("getTeamCardProneness renvoie les vrais joueurs (jaunes+rouges réels), triés par intensité, jamais un joueur sans carton ni un joueur inventé", async () => {
    const { getTeamCardProneness } = await import("../lib/apiFootball.js");
    const fetchMock = jest.fn((url) => {
      expect(url).toContain("/players?team=42&season=");
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            response: [
              { player: { name: "Joueur Discipliné" }, statistics: [{ cards: { yellow: 0, red: 0 } }] },
              { player: { name: "Joueur Averti" }, statistics: [{ cards: { yellow: 3, red: 0 } }] },
              { player: { name: "Joueur Expulsé" }, statistics: [{ cards: { yellow: 1, red: 1 } }] },
            ],
          }),
      });
    });
    global.fetch = fetchMock;

    const players = await getTeamCardProneness(42, TOKEN);
    expect(players.map((p) => p.name)).not.toContain("Joueur Discipliné"); // 0 carton : pas "susceptible"
    expect(players[0].name).toBe("Joueur Expulsé"); // jaune + rouge pèse plus lourd qu'un simple jaune
    expect(players.find((p) => p.name === "Joueur Averti").yellow).toBe(3);
  });

  test("une équipe sans aucune donnée de cartons renvoie une liste vide, jamais inventée", async () => {
    const { getTeamCardProneness } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) }));
    expect(await getTeamCardProneness(42, TOKEN)).toEqual([]);
  });

  test("une erreur de l'API (quota, réseau) renvoie une liste vide plutôt qu'un plantage", async () => {
    const { getTeamCardProneness } = await import("../lib/apiFootball.js");
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));
    expect(await getTeamCardProneness(42, TOKEN)).toEqual([]);
  });
});
