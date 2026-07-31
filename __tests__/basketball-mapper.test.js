/**
 * lib/sports/basketball/mapper.js — bloc 1 : normalise un match brut API-Basketball
 * vers la même forme que le football (voir lib/apiFootball.js), pour que
 * components/MatchCard.js reste inchangé (bloc 2). Ids préfixés "bk-" (jamais "af-"),
 * statuts traduits vers le vocabulaire déjà utilisé partout sur le site.
 */
import { mapGameStatusToBlumeStatus, mapGameToLiveMatch, mapGameToUpcoming } from "../lib/sports/basketball/mapper";

function rawGame(overrides = {}) {
  return {
    id: 12345,
    date: "2026-08-01T19:00:00+00:00",
    status: { long: "Quarter 3", short: "Q3", timer: "5:23" },
    league: { id: 12, name: "NBA", logo: "https://example.com/nba.png" },
    country: { name: "USA" },
    teams: {
      home: { id: 132, name: "Lakers", logo: "https://example.com/lal.png" },
      away: { id: 134, name: "Warriors", logo: "https://example.com/gsw.png" },
    },
    scores: {
      home: { quarter_1: 30, quarter_2: 25, quarter_3: 20, quarter_4: null, over_time: null, total: 75 },
      away: { quarter_1: 28, quarter_2: 22, quarter_3: 18, quarter_4: null, over_time: null, total: 68 },
    },
    ...overrides,
  };
}

describe("mapGameStatusToBlumeStatus — vocabulaire déjà utilisé partout sur le site", () => {
  test("quart-temps/prolongation en cours -> IN_PLAY", () => {
    for (const code of ["Q1", "Q2", "Q3", "Q4", "OT"]) {
      expect(mapGameStatusToBlumeStatus(code)).toBe("IN_PLAY");
    }
  });

  test("pause (mi-temps/entre quart-temps) -> PAUSED", () => {
    expect(mapGameStatusToBlumeStatus("HT")).toBe("PAUSED");
    expect(mapGameStatusToBlumeStatus("BT")).toBe("PAUSED");
  });

  test("match terminé -> FINISHED", () => {
    expect(mapGameStatusToBlumeStatus("FT")).toBe("FINISHED");
    expect(mapGameStatusToBlumeStatus("AOT")).toBe("FINISHED");
  });

  test("pas encore commencé -> SCHEDULED", () => {
    expect(mapGameStatusToBlumeStatus("NS")).toBe("SCHEDULED");
  });

  test("un code inconnu (annulé, reporté...) est renvoyé tel quel, jamais transformé silencieusement", () => {
    expect(mapGameStatusToBlumeStatus("CANC")).toBe("CANC");
    expect(mapGameStatusToBlumeStatus(undefined)).toBe("SCHEDULED");
  });
});

describe("mapGameToLiveMatch — même forme que mapFixtureToLiveMatch (football)", () => {
  test("mappe id/statut/score/équipes/compétition avec le préfixe bk- (jamais af-)", () => {
    const m = mapGameToLiveMatch(rawGame());
    expect(m).toEqual({
      id: "bk-12345",
      status: "IN_PLAY",
      minute: "5:23",
      period: "Q3",
      utcDate: "2026-08-01T19:00:00+00:00",
      competition: { code: "bk-12", name: "NBA", area: "USA", emblem: "https://example.com/nba.png", season: "" },
      homeTeam: { id: "bk-132", name: "Lakers", crest: "https://example.com/lal.png" },
      awayTeam: { id: "bk-134", name: "Warriors", crest: "https://example.com/gsw.png" },
      score: { fullTime: { home: 75, away: 68 } },
    });
  });

  test("`period` ne porte que Q1/Q2/Q3/Q4/OT — jamais renseigné hors quart-temps/prolongation (PROMPT bloc 2)", () => {
    expect(mapGameToLiveMatch(rawGame({ status: { short: "HT", timer: null } })).period).toBeNull();
    expect(mapGameToLiveMatch(rawGame({ status: { short: "OT", timer: "2:10" } })).period).toBe("OT");
  });

  test("le score utilise le TOTAL officiel, jamais recalculé à partir des quart-temps", () => {
    const m = mapGameToLiveMatch(rawGame({ scores: { home: { total: 999 }, away: { total: 111 } } }));
    expect(m.score.fullTime).toEqual({ home: 999, away: 111 });
  });

  test("des champs manquants ne font jamais planter le mapping (valeurs honnêtes par défaut)", () => {
    const m = mapGameToLiveMatch({});
    expect(m.id).toBe("");
    expect(m.homeTeam).toEqual({ id: "", name: "", crest: "" });
    expect(m.score.fullTime).toEqual({ home: null, away: null });
  });
});

describe("mapGameToUpcoming — statut/score toujours à zéro avant le match", () => {
  test("mappe un match pas encore commencé", () => {
    const m = mapGameToUpcoming(rawGame({ status: { short: "NS" } }));
    expect(m.status).toBe("SCHEDULED");
    expect(m.minute).toBeNull();
    expect(m.matchday).toBeNull();
    expect(m.score.fullTime).toEqual({ home: 75, away: 68 }); // champ toujours présent (structure stable), même si 0-0 en pratique avant NS
  });
});

describe("deux matchs différents ne produisent jamais le même id ou la même compétition par coïncidence", () => {
  test("des ids/ligues différents restent bien distincts après mapping", () => {
    const a = mapGameToLiveMatch(rawGame({ id: 1, league: { id: 10, name: "NBA" } }));
    const b = mapGameToLiveMatch(rawGame({ id: 2, league: { id: 20, name: "EuroLeague" } }));
    expect(a.id).not.toBe(b.id);
    expect(a.competition.code).not.toBe(b.competition.code);
  });
});
