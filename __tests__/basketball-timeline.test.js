/**
 * lib/sports/basketball/timeline.js — bloc 4 : "Moments forts" du basket, TOUJOURS
 * rempli une fois le match commencé (jamais "Événement non disponible"), reconstruit
 * à partir du VRAI score officiel (jamais un panier/joueur précis inventé, faute de
 * play-by-play côté API-Basketball).
 */
import { recordSnapshotAndBuildTimeline, __resetTimelineHistoryForTests } from "../lib/sports/basketball/timeline";

function game({ id = 1, short = "Q1", timer = "10:00", home = {}, away = {} } = {}) {
  return {
    id,
    status: { short, timer },
    scores: {
      home: { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, total: 0, ...home },
      away: { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, total: 0, ...away },
    },
  };
}

beforeEach(() => {
  __resetTimelineHistoryForTests();
});

test("dès le premier appel (match qui vient de démarrer) : au moins le coup d'envoi, jamais un tableau vide", () => {
  const events = recordSnapshotAndBuildTimeline(1, game({ home: { total: 2 }, away: { total: 0 } }));
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].kind).toBe("KICKOFF");
});

test("sans id ou sans match : tableau vide (mais jamais une exception)", () => {
  expect(recordSnapshotAndBuildTimeline(null, game())).toEqual([]);
  expect(recordSnapshotAndBuildTimeline(1, null)).toEqual([]);
});

test("fin de quart-temps : dérivée du VRAI score cumulé (quarter_1..N), jamais une estimation", () => {
  const g = game({
    short: "Q2", timer: "8:00",
    home: { quarter_1: 28, total: 28 }, away: { quarter_1: 22, total: 22 },
  });
  const events = recordSnapshotAndBuildTimeline(1, g);
  const q1End = events.find((e) => e.id === "quarter-end-1");
  expect(q1End).toBeDefined();
  expect(q1End.label).toContain("28 - 22");
});

test("aucun quart-temps terminé (Q1 en cours) : pas d'événement de fin de quart-temps prématuré", () => {
  const g = game({ short: "Q1", home: { total: 10 }, away: { total: 8 } });
  const events = recordSnapshotAndBuildTimeline(1, g);
  expect(events.find((e) => e.kind === "QUARTER_END")).toBeUndefined();
});

test("changement de leader détecté entre deux relevés successifs suivis en direct", () => {
  recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 10 }, away: { total: 8 } }));
  recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 10 }, away: { total: 15 } }));
  const events = recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 12 }, away: { total: 15 } }));
  const leadChange = events.find((e) => e.kind === "LEAD_CHANGE");
  expect(leadChange).toBeDefined();
  expect(leadChange.label).toContain("10 - 15");
});

test("série de points (run) : détectée quand une seule équipe marque un écart net entre deux relevés", () => {
  recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 20 }, away: { total: 18 } }));
  const events = recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 28 }, away: { total: 18 } }), {
    homeTeamName: "Lakers", awayTeamName: "Warriors",
  });
  const run = events.find((e) => e.kind === "RUN");
  expect(run).toBeDefined();
  expect(run.label).toContain("Série de 8-0 pour Lakers");
});

test("un petit écart (sous le seuil) n'est jamais signalé comme une série", () => {
  recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 20 }, away: { total: 18 } }));
  const events = recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 22 }, away: { total: 18 } }));
  expect(events.find((e) => e.kind === "RUN")).toBeUndefined();
});

test("fin de match : événement dédié avec le vrai score final, uniquement si le statut est FT/AOT", () => {
  const g = game({ short: "FT", home: { total: 108 }, away: { total: 101 } });
  const events = recordSnapshotAndBuildTimeline(1, g);
  const final = events.find((e) => e.kind === "FULL_TIME");
  expect(final).toBeDefined();
  expect(final.label).toContain("108 - 101");
});

test("deux relevés identiques (score inchangé) ne créent jamais de doublon dans l'historique", () => {
  const g = game({ short: "Q1", home: { total: 10 }, away: { total: 8 } });
  recordSnapshotAndBuildTimeline(1, g);
  recordSnapshotAndBuildTimeline(1, g);
  const events = recordSnapshotAndBuildTimeline(1, g);
  expect(events.filter((e) => e.kind === "LEAD_CHANGE" || e.kind === "RUN")).toHaveLength(0);
});

test("deux matchs différents ont des historiques totalement indépendants", () => {
  recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 10 }, away: { total: 8 } }));
  recordSnapshotAndBuildTimeline(1, game({ short: "Q1", home: { total: 30 }, away: { total: 8 } }));

  // Le match 2 n'a encore qu'un seul relevé : aucun changement de leader/série à
  // détecter, malgré l'historique déjà riche du match 1.
  const eventsGame2 = recordSnapshotAndBuildTimeline(2, game({ id: 2, short: "Q1", home: { total: 5 }, away: { total: 4 } }));
  expect(eventsGame2.filter((e) => e.kind === "LEAD_CHANGE" || e.kind === "RUN")).toHaveLength(0);
});
