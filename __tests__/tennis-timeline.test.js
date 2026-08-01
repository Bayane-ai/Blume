/**
 * lib/sports/tennis/timeline.js — bloc 8 : "Moments forts" du tennis, TOUJOURS rempli
 * une fois le match commencé (jamais "Événement non disponible"), reconstruit à partir
 * du VRAI score par set/par jeu (breaks, sets, jeux décisifs, séries) et, en source de
 * secours, des statistiques agrégées du match (balles de break sauvées).
 */
import { recordSnapshotAndBuildTimeline, __resetTimelineHistoryForTests } from "../lib/sports/tennis/timeline";

function liveMatch({ status = "IN_PLAY", sets = [], server = null } = {}) {
  return { status, sets, server };
}

beforeEach(() => {
  __resetTimelineHistoryForTests();
});

test("dès le premier appel (match qui vient de démarrer) : au moins le début du match, jamais un tableau vide", () => {
  const events = recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 1, away: 0 }] }), null);
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].kind).toBe("START");
});

test("sans id ou sans état live : tableau vide (mais jamais une exception)", () => {
  expect(recordSnapshotAndBuildTimeline(null, liveMatch())).toEqual([]);
  expect(recordSnapshotAndBuildTimeline("1", null)).toEqual([]);
});

test("break détecté : un jeu gagné par le joueur qui NE servait PAS au relevé précédent", () => {
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 2, away: 2 }], server: "away" }));
  const events = recordSnapshotAndBuildTimeline(
    "1", liveMatch({ sets: [{ home: 3, away: 2 }], server: "home" }), null, { homeTeamName: "Djokovic", awayTeamName: "Alcaraz" }
  );
  const brk = events.find((e) => e.kind === "BREAK");
  expect(brk).toBeDefined();
  expect(brk.label).toContain("Djokovic");
});

test("jeu tenu au service (pas de break) n'est jamais signalé comme un break", () => {
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 2, away: 2 }], server: "home" }));
  const events = recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 3, away: 2 }], server: "home" }));
  expect(events.find((e) => e.kind === "BREAK")).toBeUndefined();
});

test("set remporté : dérivé du VRAI score du set (6 jeux, 2 d'écart)", () => {
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 5, away: 4 }], server: "home" }));
  const events = recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 6, away: 4 }], server: "away" }));
  const setWon = events.find((e) => e.kind === "SET_WON");
  expect(setWon).toBeDefined();
  expect(setWon.label).toContain("6-4");
});

test("jeu décisif détecté sur un set terminé 7-6", () => {
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 6, away: 6 }], server: "home" }));
  const events = recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 7, away: 6 }], server: "away" }));
  expect(events.find((e) => e.kind === "TIEBREAK")).toBeDefined();
});

test("série de jeux consécutifs : détectée après plusieurs jeux gagnés d'affilée par le même joueur", () => {
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 1, away: 0 }], server: "away" }));
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 2, away: 0 }], server: "home" }));
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 3, away: 0 }], server: "away" }));
  const events = recordSnapshotAndBuildTimeline(
    "1", liveMatch({ sets: [{ home: 4, away: 0 }], server: "home" }), null, { homeTeamName: "Djokovic", awayTeamName: "Alcaraz" }
  );
  const run = events.find((e) => e.kind === "RUN");
  expect(run).toBeDefined();
  expect(run.label).toContain("Djokovic");
});

test("balles de break sauvées : dérivées des statistiques agrégées (source de secours), jamais inventées", () => {
  const statsBefore = { home: { breakPointsWon: { made: 0, attempted: 0 } }, away: { breakPointsWon: { made: 1, attempted: 3 } } };
  const statsAfter = { home: { breakPointsWon: { made: 0, attempted: 0 } }, away: { breakPointsWon: { made: 1, attempted: 4 } } };
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 2, away: 2 }], server: "home" }), statsBefore);
  const events = recordSnapshotAndBuildTimeline(
    "1", liveMatch({ sets: [{ home: 2, away: 2 }], server: "home" }), statsAfter, { homeTeamName: "Djokovic" }
  );
  const saved = events.find((e) => e.kind === "BREAK_POINT_SAVED");
  expect(saved).toBeDefined();
  expect(saved.label).toContain("Djokovic");
});

test("aucune statistique agrégée disponible : jamais de balle de break sauvée inventée", () => {
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 2, away: 2 }], server: "home" }), null);
  const events = recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 3, away: 2 }], server: "away" }), null);
  expect(events.find((e) => e.kind === "BREAK_POINT_SAVED")).toBeUndefined();
});

test("fin de match : événement dédié avec le vrai score en sets, uniquement si le statut est FINISHED", () => {
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 6, away: 4 }, { home: 6, away: 3 }], server: "home" }));
  const events = recordSnapshotAndBuildTimeline(
    "1", liveMatch({ status: "FINISHED", sets: [{ home: 6, away: 4 }, { home: 6, away: 3 }], server: "home" })
  );
  const final = events.find((e) => e.kind === "FULL_TIME");
  expect(final).toBeDefined();
  expect(final.label).toContain("2 sets à 0");
});

test("deux relevés identiques (score inchangé) ne créent jamais de doublon dans l'historique", () => {
  const state = liveMatch({ sets: [{ home: 2, away: 2 }], server: "home" });
  recordSnapshotAndBuildTimeline("1", state);
  recordSnapshotAndBuildTimeline("1", state);
  const events = recordSnapshotAndBuildTimeline("1", state);
  expect(events.filter((e) => e.kind === "BREAK" || e.kind === "SET_WON")).toHaveLength(0);
});

test("deux matchs différents ont des historiques totalement indépendants", () => {
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 2, away: 2 }], server: "home" }));
  recordSnapshotAndBuildTimeline("1", liveMatch({ sets: [{ home: 3, away: 2 }], server: "away" }));

  const eventsMatch2 = recordSnapshotAndBuildTimeline("2", liveMatch({ sets: [{ home: 1, away: 0 }], server: "home" }));
  expect(eventsMatch2.filter((e) => e.kind === "BREAK" || e.kind === "SET_WON")).toHaveLength(0);
});
