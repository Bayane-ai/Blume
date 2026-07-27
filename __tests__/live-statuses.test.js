/**
 * lib/liveStatuses.js — source UNIQUE des statuts football-data.org considérés
 * "en direct" (voir PROMPT : "1ère mi-temps, mi-temps, 2ème mi-temps, prolongations,
 * temps additionnel. Ne te limite pas à un seul statut") — corrige un bug réel où
 * IN_PLAY/PAUSED étaient dupliqués séparément dans une dizaine de fichiers, sans
 * EXTRA_TIME ni PENALTY_SHOOTOUT, faisant disparaître un match en prolongations ou
 * aux tirs au but de la liste "en direct".
 */
import { LIVE_STATUSES, LIVE_STATUS_QUERY } from "../lib/liveStatuses";

test("couvre tous les statuts réellement en direct : 1ère/2e mi-temps (IN_PLAY), mi-temps (PAUSED), prolongations (EXTRA_TIME), tirs au but (PENALTY_SHOOTOUT)", () => {
  expect(LIVE_STATUSES).toEqual(
    expect.arrayContaining(["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT"])
  );
  expect(LIVE_STATUSES).toHaveLength(4);
});

test("ne contient jamais un statut qui n'est PAS en direct (SCHEDULED, TIMED, FINISHED...)", () => {
  ["SCHEDULED", "TIMED", "FINISHED", "SUSPENDED", "POSTPONED", "CANCELLED", "AWARDED"].forEach((s) => {
    expect(LIVE_STATUSES).not.toContain(s);
  });
});

test("LIVE_STATUS_QUERY (paramètre envoyé à l'API) inclut le raccourci LIVE en plus de la liste explicite", () => {
  expect(LIVE_STATUS_QUERY).toBe("LIVE,IN_PLAY,PAUSED,EXTRA_TIME,PENALTY_SHOOTOUT");
});
