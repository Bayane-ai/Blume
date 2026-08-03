/**
 * lib/sports/tennis/mapper.js — normalise un match Live Tennis API (liste + détail
 * de score, deux endpoints séparés — voir lib/sports/tennis/provider.js) vers la même
 * forme que le football/basket, pour que components/MatchCard.js reste inchangé. Ids
 * préfixés "tn-" (jamais "af-"/"bk-"). Forme exacte non vérifiable en direct (réseau
 * bloqué depuis ce sandbox) : chaque champ est tenté à plusieurs emplacements
 * plausibles, jamais une valeur inventée quand absente.
 */
import { mapMatchStatusToBlumeStatus, mapMatchToLiveState } from "../lib/sports/tennis/mapper";

function rawMatch(overrides = {}) {
  return {
    id: 555,
    date: "2026-08-01T14:00:00+00:00",
    status: "live",
    tournament: { id: 12, name: "Wimbledon", surface: "grass", category: "Grand Slam", country: "United Kingdom" },
    round: "Quarterfinal",
    player1: { id: 101, name: "Novak Djokovic", photo: "https://example.com/djokovic.png" },
    player2: { id: 102, name: "Carlos Alcaraz", photo: "https://example.com/alcaraz.png" },
    ...overrides,
  };
}

function rawScore(overrides = {}) {
  return {
    sets: [{ p1: 6, p2: 4 }, { p1: 3, p2: 5 }],
    currentGame: { p1: 40, p2: 30 },
    server: "player1",
    ...overrides,
  };
}

describe("mapMatchStatusToBlumeStatus — vocabulaire détecté par mot-clé (pas un code exact fragile)", () => {
  test("statut contenant 'live' -> IN_PLAY", () => {
    expect(mapMatchStatusToBlumeStatus("live")).toBe("IN_PLAY");
    expect(mapMatchStatusToBlumeStatus("in_progress")).toBe("IN_PLAY");
  });

  test("pas encore commencé -> SCHEDULED", () => {
    expect(mapMatchStatusToBlumeStatus("scheduled")).toBe("SCHEDULED");
    expect(mapMatchStatusToBlumeStatus("not_started")).toBe("SCHEDULED");
  });

  test("terminé (y compris abandon/forfait) -> FINISHED", () => {
    expect(mapMatchStatusToBlumeStatus("finished")).toBe("FINISHED");
    expect(mapMatchStatusToBlumeStatus("retired")).toBe("FINISHED");
    expect(mapMatchStatusToBlumeStatus("walkover")).toBe("FINISHED");
  });

  test("statut vide/inconnu : jamais transformé silencieusement en autre chose", () => {
    expect(mapMatchStatusToBlumeStatus(undefined)).toBe("SCHEDULED");
    expect(mapMatchStatusToBlumeStatus("postponed")).toBe("SUSPENDED");
  });
});

describe("mapMatchToLiveState — fusionne la liste (rawMatch) et le détail de score (rawScore)", () => {
  test("mappe id/statut/joueurs/tournoi avec le préfixe tn-", () => {
    const m = mapMatchToLiveState(rawMatch(), rawScore());
    expect(m.id).toBe("tn-555");
    expect(m.status).toBe("IN_PLAY");
    expect(m.homeTeam).toEqual({ id: "tn-101", name: "Novak Djokovic", crest: "https://example.com/djokovic.png", flag: null, ranking: null });
    expect(m.awayTeam).toEqual({ id: "tn-102", name: "Carlos Alcaraz", crest: "https://example.com/alcaraz.png", flag: null, ranking: null });
    expect(m.competition.code).toBe("tn-12");
    expect(m.competition.name).toBe("Wimbledon");
    expect(m.competition.surface).toBe("Gazon");
    expect(m.competition.category).toBe("Grand Slam");
  });

  test("le score utilise les VRAIS sets gagnés (1 partout : 1er set domicile, 2e extérieur)", () => {
    const m = mapMatchToLiveState(rawMatch(), rawScore());
    expect(m.score.fullTime).toEqual({ home: 1, away: 1 });
  });

  test("period = numéro du set en cours, minute = score du jeu en cours — uniquement en direct", () => {
    const m = mapMatchToLiveState(rawMatch(), rawScore());
    expect(m.period).toBe("Set 2");
    expect(m.minute).toBe("40-30");
  });

  test("match pas en direct : ni period ni minute ni server (jamais une valeur inventée)", () => {
    const m = mapMatchToLiveState(rawMatch({ status: "scheduled" }), null);
    expect(m.period).toBeNull();
    expect(m.minute).toBeNull();
    expect(m.server).toBeNull();
  });

  test("conserve le détail set par set, jamais un point par point inventé", () => {
    const m = mapMatchToLiveState(rawMatch(), rawScore());
    expect(m.sets).toEqual([{ home: 6, away: 4 }, { home: 3, away: 5 }]);
  });

  test("aucun score détaillé disponible (rawScore null) : retombe sur ce que la liste fournit déjà elle-même, sans planter", () => {
    const m = mapMatchToLiveState(rawMatch({ sets: [{ home: 2, away: 1 }] }), null);
    expect(m.sets).toEqual([{ home: 2, away: 1 }]);
  });

  test("surface absente : honnêtement null, jamais une surface inventée", () => {
    const m = mapMatchToLiveState(rawMatch({ tournament: { id: 12, name: "Tournoi X" } }), rawScore());
    expect(m.competition.surface).toBeNull();
  });

  test("des champs manquants ne font jamais planter le mapping (valeurs honnêtes par défaut)", () => {
    const m = mapMatchToLiveState({}, null);
    expect(m.id).toBe("");
    expect(m.homeTeam).toEqual({ id: "", name: "", crest: "", flag: null, ranking: null });
    expect(m.score.fullTime).toEqual({ home: 0, away: 0 });
    expect(m.sets).toEqual([]);
  });

  test("joueur au service détecté via server: 'player1'/'player2'", () => {
    const home = mapMatchToLiveState(rawMatch(), rawScore({ server: "player1" }));
    expect(home.server).toBe("home");
    const away = mapMatchToLiveState(rawMatch(), rawScore({ server: "player2" }));
    expect(away.server).toBe("away");
  });

  test("jamais un service deviné quand la source ne l'indique pas", () => {
    const m = mapMatchToLiveState(rawMatch(), rawScore({ server: undefined }));
    expect(m.server).toBeNull();
  });

  test("classement du joueur repris quand fourni", () => {
    const m = mapMatchToLiveState(rawMatch({ player1: { id: 101, name: "Djokovic", ranking: 1 } }), rawScore());
    expect(m.homeTeam.ranking).toBe(1);
  });
});

describe("drapeau du joueur", () => {
  test("lu sur player1.flag quand présent", () => {
    const m = mapMatchToLiveState(rawMatch({ player1: { id: 101, name: "Djokovic", flag: "https://example.com/rs.png" } }), rawScore());
    expect(m.homeTeam.flag).toBe("https://example.com/rs.png");
  });

  test("jamais un drapeau inventé quand la source ne le fournit pas", () => {
    const m = mapMatchToLiveState(rawMatch({ player1: { id: 101, name: "Djokovic" } }), rawScore());
    expect(m.homeTeam.flag).toBeNull();
  });
});
