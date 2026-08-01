/**
 * lib/sports/tennis/mapper.js — bloc 5 : normalise un match brut API-Tennis vers la
 * même forme que le football/basket (voir lib/apiFootball.js, lib/sports/
 * basketball/mapper.js), pour que components/MatchCard.js reste inchangé. Ids
 * préfixés "tn-" (jamais "af-"/"bk-"), statuts détectés par mot-clé (vocabulaire
 * exact non confirmable en direct depuis cet environnement, voir provider.js).
 */
import { mapMatchStatusToBlumeStatus, mapMatchToLiveState, mapMatchToUpcoming } from "../lib/sports/tennis/mapper";

function rawGame(overrides = {}) {
  return {
    id: 555,
    date: "2026-08-01T14:00:00+00:00",
    status: { long: "Set 2", short: "Set2" },
    league: { id: 12, name: "Wimbledon", logo: "https://example.com/wimbledon.png", type: "Grand Slam", surface: "grass" },
    country: { name: "United Kingdom" },
    season: 2026,
    round: "Quarterfinal",
    teams: {
      home: { id: 101, name: "Novak Djokovic", logo: "https://example.com/djokovic.png" },
      away: { id: 102, name: "Carlos Alcaraz", logo: "https://example.com/alcaraz.png" },
    },
    scores: {
      home: { set_1: 6, set_2: 3, set_3: null, set_4: null, set_5: null, game: 40 },
      away: { set_1: 4, set_2: 5, set_3: null, set_4: null, set_5: null, game: 30 },
    },
    ...overrides,
  };
}

describe("mapMatchStatusToBlumeStatus — vocabulaire détecté par mot-clé (pas un code exact fragile)", () => {
  test("un set en cours -> IN_PLAY", () => {
    expect(mapMatchStatusToBlumeStatus({ long: "Set 1", short: "Set1" })).toBe("IN_PLAY");
    expect(mapMatchStatusToBlumeStatus({ long: "1st Set", short: "1S" })).toBe("IN_PLAY");
  });

  test("pas encore commencé -> SCHEDULED", () => {
    expect(mapMatchStatusToBlumeStatus({ long: "Not Started", short: "NS" })).toBe("SCHEDULED");
  });

  test("terminé (y compris abandon/forfait) -> FINISHED", () => {
    expect(mapMatchStatusToBlumeStatus({ long: "Finished", short: "FT" })).toBe("FINISHED");
    expect(mapMatchStatusToBlumeStatus({ long: "Retired", short: "Ret." })).toBe("FINISHED");
    expect(mapMatchStatusToBlumeStatus({ long: "Walkover", short: "W.O." })).toBe("FINISHED");
  });

  test("pause (changement de côté, pluie...) -> PAUSED", () => {
    expect(mapMatchStatusToBlumeStatus({ long: "Rain Delay", short: "Rain" })).toBe("PAUSED");
  });

  test("statut vide/inconnu : jamais transformé silencieusement en autre chose", () => {
    expect(mapMatchStatusToBlumeStatus(undefined)).toBe("SCHEDULED");
    expect(mapMatchStatusToBlumeStatus({ long: "Postponed", short: "Postp." })).toBe("POSTP.");
  });
});

describe("mapMatchToLiveState — même forme que les autres sports, avec le préfixe tn- (jamais af-/bk-)", () => {
  test("mappe id/statut/score (sets gagnés)/joueurs/tournoi avec le préfixe tn-", () => {
    const m = mapMatchToLiveState(rawGame());
    expect(m.id).toBe("tn-555");
    expect(m.status).toBe("IN_PLAY");
    expect(m.homeTeam).toEqual({ id: "tn-101", name: "Novak Djokovic", crest: "https://example.com/djokovic.png", flag: null });
    expect(m.awayTeam).toEqual({ id: "tn-102", name: "Carlos Alcaraz", crest: "https://example.com/alcaraz.png", flag: null });
    expect(m.competition.code).toBe("tn-12");
    expect(m.competition.name).toBe("Wimbledon");
    expect(m.competition.surface).toBe("Gazon");
    expect(m.competition.category).toBe("Grand Slam");
    expect(m.utcDate).toBe("2026-08-01T14:00:00+00:00");
  });

  test("le score utilise les VRAIS sets gagnés (1 set partout ici : 1er set gagné par le domicile, 2ème par l'extérieur, tous deux terminés)", () => {
    const m = mapMatchToLiveState(rawGame());
    expect(m.score.fullTime).toEqual({ home: 1, away: 1 });
  });

  test("period = numéro du set en cours, minute = score du jeu en cours — uniquement si le match est réellement en direct", () => {
    const m = mapMatchToLiveState(rawGame());
    expect(m.period).toBe("Set 2");
    expect(m.minute).toBe("40-30");
  });

  test("match pas en direct : ni period ni minute (jamais une valeur inventée pour un match qui n'est pas en cours)", () => {
    const m = mapMatchToLiveState(rawGame({ status: { long: "Not Started", short: "NS" } }));
    expect(m.period).toBeNull();
    expect(m.minute).toBeNull();
  });

  test("conserve le détail set par set (sets) — donnée la plus fine réellement disponible, jamais un point par point inventé", () => {
    const m = mapMatchToLiveState(rawGame());
    expect(m.sets).toEqual([{ home: 6, away: 4 }, { home: 3, away: 5 }]);
  });

  test("préfère un total de sets gagnés fourni directement par la source plutôt qu'un recalcul (fiable même en cas d'abandon en cours de set)", () => {
    const m = mapMatchToLiveState(rawGame({ scores: { home: { set_1: 6, total: 2 }, away: { set_1: 3, total: 0 } } }));
    expect(m.score.fullTime).toEqual({ home: 2, away: 0 });
  });

  test("surface absente : honnêtement null, jamais une surface inventée", () => {
    const m = mapMatchToLiveState(rawGame({ league: { id: 12, name: "Tournoi X" } }));
    expect(m.competition.surface).toBeNull();
  });

  test("des champs manquants ne font jamais planter le mapping (valeurs honnêtes par défaut)", () => {
    const m = mapMatchToLiveState({});
    expect(m.id).toBe("");
    expect(m.homeTeam).toEqual({ id: "", name: "", crest: "", flag: null });
    expect(m.score.fullTime).toEqual({ home: 0, away: 0 });
    expect(m.sets).toEqual([]);
  });
});

describe("mapMatchToUpcoming — statut/score toujours neutres avant le match", () => {
  test("mappe un match pas encore commencé", () => {
    const m = mapMatchToUpcoming(rawGame({ status: { long: "Not Started", short: "NS" } }));
    expect(m.id).toBe("tn-555");
    expect(m.status).toBe("SCHEDULED");
    expect(m.score.fullTime).toEqual({ home: null, away: null });
    expect(m.minute).toBeNull();
  });

  test("catégorie/tournoi jamais filtrés (ATP/WTA/Grand Chelem/Masters 1000/250/500/Challenger/ITF)", () => {
    for (const category of ["ATP", "WTA", "Grand Slam", "Masters 1000", "ATP 250", "ATP 500", "Challenger", "ITF"]) {
      const m = mapMatchToUpcoming(rawGame({ league: { id: 1, name: "Test", type: category } }));
      expect(m.competition.category).toBe(category);
    }
  });

  test("un match à venir n'a jamais de joueur au service (pas encore commencé)", () => {
    const m = mapMatchToUpcoming(rawGame({ status: { long: "Not Started", short: "NS" } }));
    expect(m.server).toBeUndefined();
  });
});

describe("drapeau du joueur (PROMPT bloc 6, point 1)", () => {
  test("lu sur teams.home.flag quand présent", () => {
    const m = mapMatchToLiveState(
      rawGame({ teams: { home: { id: 101, name: "Novak Djokovic", flag: "https://example.com/rs.png" }, away: { id: 102, name: "Carlos Alcaraz" } } })
    );
    expect(m.homeTeam.flag).toBe("https://example.com/rs.png");
  });

  test("repli sur teams.home.country.flag si le champ direct est absent", () => {
    const m = mapMatchToLiveState(
      rawGame({
        teams: {
          home: { id: 101, name: "Novak Djokovic", country: { flag: "https://example.com/rs.png" } },
          away: { id: 102, name: "Carlos Alcaraz" },
        },
      })
    );
    expect(m.homeTeam.flag).toBe("https://example.com/rs.png");
  });

  test("jamais un drapeau inventé quand la source ne le fournit pas", () => {
    const m = mapMatchToLiveState(rawGame({ teams: { home: { id: 101, name: "Novak Djokovic" }, away: { id: 102, name: "Carlos Alcaraz" } } }));
    expect(m.homeTeam.flag).toBeNull();
    expect(m.awayTeam.flag).toBeNull();
  });
});

describe("joueur au service (PROMPT bloc 6, point 1)", () => {
  test("détecté via scores.home.serve / scores.away.serve", () => {
    const home = mapMatchToLiveState(rawGame({ scores: { home: { set_1: 6, game: 40, serve: true }, away: { set_1: 4, game: 30, serve: false } } }));
    expect(home.server).toBe("home");
    const away = mapMatchToLiveState(rawGame({ scores: { home: { set_1: 6, game: 40, serve: false }, away: { set_1: 4, game: 30, serve: true } } }));
    expect(away.server).toBe("away");
  });

  test("jamais un service deviné quand la source ne l'indique pas — même en direct", () => {
    const m = mapMatchToLiveState(rawGame());
    expect(m.server).toBeNull();
  });

  test("jamais renseigné pour un match qui n'est pas en direct (terminé)", () => {
    const m = mapMatchToLiveState(
      rawGame({ status: { long: "Finished", short: "FT" }, scores: { home: { set_1: 6, set_2: 6, serve: true }, away: { set_1: 3, set_2: 2, serve: false } } })
    );
    expect(m.server).toBeNull();
  });
});
