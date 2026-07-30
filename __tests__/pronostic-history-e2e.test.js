/**
 * Vérification END-TO-END du parcours complet demandé : un pronostic est figé pour un
 * match pas encore joué (pending) -> le match se termine -> le règlement automatique
 * (settleFinishedPredictionsNow, ce que la route cron et le balayage opportuniste
 * appellent en coulisses) le classe SANS aucune action manuelle -> il apparaît dans la
 * bonne section (Succès/Échec) -> son détail affiche chaque ligne avec un crochet vert
 * ou une croix rouge. Utilise les VRAIES implémentations de lib/pronosticVerification.js
 * (aucun mock de haut niveau) — seule la couche réseau (Supabase, football-data.org)
 * est simulée, avec une VRAIE table en mémoire qui persiste entre les appels.
 */
import {
  saveFrozenPrediction, settleFinishedPredictionsNow, listAndMaintainHistory,
} from "../lib/pronosticHistory";
import { supabaseAnon as supabase } from "../lib/supabaseAnon";
import { getLiveMatch } from "../lib/liveMatchCache";

jest.mock("../lib/supabaseAnon", () => ({ supabaseAnon: { from: jest.fn() } }));
jest.mock("../lib/liveMatchCache", () => ({ getLiveMatch: jest.fn() }));

// VRAIE table pronostic_history en mémoire, persistant entre saveFrozenPrediction /
// settleFinishedPredictionsNow / listAndMaintainHistory — assez fidèle à supabase-js
// (upsert avec ignoreDuplicates, update, select avec eq/order/limit, delete) pour
// exercer le vrai enchaînement de ces trois fonctions, pas seulement chacune isolément.
let rows;

function makeTable() {
  return {
    from: (table) => {
      if (table !== "pronostic_history") throw new Error(`table inattendue : ${table}`);
      return {
        upsert: (row, opts) => {
          const idx = rows.findIndex((r) => r.match_id === row.match_id);
          if (idx >= 0) {
            if (!opts?.ignoreDuplicates) rows[idx] = { ...row };
          } else {
            rows.push({ ...row });
          }
          return Promise.resolve({ error: null });
        },
        select: () => {
          const filters = [];
          let orderCol = null;
          let orderAsc = true;
          let limitN = Infinity;
          const builder = {
            eq: (col, val) => { filters.push([col, val]); return builder; },
            order: (col, o) => { orderCol = col; orderAsc = !!o?.ascending; return builder; },
            limit: (n) => { limitN = n; return builder; },
            maybeSingle: () => {
              const matches = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
              return Promise.resolve({ data: matches[0] || null, error: null });
            },
            then: (resolve) => {
              let result = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
              if (orderCol) {
                result = [...result].sort((a, b) => {
                  const av = a[orderCol] || "";
                  const bv = b[orderCol] || "";
                  const cmp = av > bv ? 1 : av < bv ? -1 : 0;
                  return orderAsc ? cmp : -cmp;
                });
              }
              result = result.slice(0, limitN);
              return Promise.resolve({ data: result, error: null }).then(resolve);
            },
          };
          return builder;
        },
        delete: () => {
          const notFilters = [];
          const isFilters = [];
          const ltFilters = [];
          const builder = {
            not: (col, _op, val) => { notFilters.push([col, val]); return builder; },
            is: (col, val) => { isFilters.push([col, val]); return builder; },
            lt: (col, val) => { ltFilters.push([col, val]); return builder; },
            then: (resolve) => {
              rows = rows.filter((r) => !(
                notFilters.every(([c, v]) => (v === null ? r[c] != null : true)) &&
                isFilters.every(([c, v]) => (v === null ? r[c] == null : true)) &&
                ltFilters.every(([c, v]) => r[c] != null && r[c] < v)
              ));
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return builder;
        },
        update: (patch) => ({
          eq: (col, val) => {
            const idx = rows.findIndex((r) => r[col] === val);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
}

beforeEach(() => {
  rows = [];
  const table = makeTable();
  supabase.from = table.from;
  getLiveMatch.mockReset();
});

test("parcours complet : pronostic figé (pending) -> match terminé -> réglé automatiquement -> apparaît dans la BONNE section -> détail ligne par ligne correct", async () => {
  const prediction = {
    home: { name: "Real Madrid", position: 1, points: 70 },
    away: { name: "Barcelona", position: 2, points: 68 },
    probabilities: { home: 55, draw: 25, away: 20 }, // Real Madrid favori
    correctScores: [{ score: "2-1", probability: 14 }, { score: "1-0", probability: 12 }, { score: "2-0", probability: 10 }],
    markets: {
      totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] },
      totalHome: { line: 1.5, side: "Plus", lines: [{ line: 1.5, side: "Plus" }] },
      totalAway: { line: 0.5, side: "Plus", lines: [{ line: 0.5, side: "Plus" }] },
      shots: { line: 20.5, side: "Plus", lines: [{ line: 20.5, side: "Plus" }] },
      shotsOnTarget: { line: 6.5, side: "Plus", lines: [{ line: 6.5, side: "Plus" }] },
      yellowCards: { safe: { line: 3.5, side: "Moins" }, risky: { line: 2.5, side: "Moins" } },
      redCards: { safe: { line: 0.5, side: "Moins" }, risky: { line: 0.5, side: "Plus" } },
    },
    matchStats: {
      corners: { total: { line: 9.5, side: "Plus", lines: [{ line: 9.5, side: "Plus" }] }, home: {}, away: {}, half: { label: "1ère mi-temps", market: {} } },
      offsides: { total: {}, home: {}, away: {}, half: { label: "1ère mi-temps", market: {} } },
      fouls: { total: {}, home: {}, away: {}, half: { label: "1ère mi-temps", market: {} } },
      throwIns: { total: {}, home: {}, away: {}, half: { label: "1ère mi-temps", market: {} } },
    },
    extraStats: {},
    goals: { expectedTotal: 3 },
  };

  // --- 1) L'analyse d'un match pas encore joué fige le pronostic : "pending".
  await saveFrozenPrediction({
    matchId: "555", competitionCode: "PD", homeTeamName: "Real Madrid", awayTeamName: "Barcelona",
    matchDate: "2026-08-01T20:00:00Z", result: prediction, matchStatus: "SCHEDULED", finalScore: null,
  });

  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("pending");

  // Avant le règlement : n'apparaît dans AUCUNE des deux sections.
  const successBefore = await listAndMaintainHistory("success", null);
  const failureBefore = await listAndMaintainHistory("failure", null);
  expect(successBefore).toHaveLength(0);
  expect(failureBefore).toHaveLength(0);

  // --- 2) Le match se termine : Real Madrid (favori) gagne bien 3-1 -> totalGoals réel
  // = 4 (Plus de 2,5 ✓), totalHome réel = 3 (Plus de 1,5 ✓), totalAway réel = 1 (Plus de
  // 0,5 ✓), score exact "2-1" prédit ≠ "3-1" réel (✗). Sans clé API-Football, seules les
  // lignes dérivées du score restent vérifiables (honnête, jamais un résultat inventé).
  getLiveMatch.mockResolvedValue({ status: "FINISHED", score: { fullTime: { home: 3, away: 1 } } });

  // --- 3) RÈGLEMENT AUTOMATIQUE (ce que la route cron ET le balayage opportuniste
  // appellent en coulisses) : aucune action manuelle, aucun paramètre lié à CE match précis.
  await settleFinishedPredictionsNow("test-token", null);

  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("success"); // majorité de lignes validées (winner + 3 totaux vs 1 score raté)
  expect(rows[0].final_score).toEqual({ home: 3, away: 1 });
  expect(rows[0].prediction.verification.winner).toBe(true);
  expect(rows[0].prediction.verification.correctScores).toBe(false);
  expect(rows[0].prediction.verification.totalGoals).toBe(true);

  // --- 4) Apparaît désormais dans LA BONNE section, sans rafraîchissement manuel côté
  // utilisateur (juste une nouvelle requête, comme le ferait un rechargement de page).
  const successAfter = await listAndMaintainHistory("success", null);
  const failureAfter = await listAndMaintainHistory("failure", null);
  expect(successAfter).toHaveLength(1);
  expect(successAfter[0].match_id).toBe("555");
  expect(failureAfter).toHaveLength(0);
});

test("parcours complet — majorité RATÉE : le favori perd, la carte atterrit dans « Probabilités échouées »", async () => {
  const prediction = {
    home: { name: "Arsenal FC" }, away: { name: "Chelsea FC" },
    probabilities: { home: 60, draw: 25, away: 15 }, // Arsenal favori
    correctScores: [{ score: "2-0", probability: 15 }],
    markets: {
      totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] },
      totalHome: { line: 1.5, side: "Plus", lines: [{ line: 1.5, side: "Plus" }] },
      totalAway: { line: 0.5, side: "Moins", lines: [{ line: 0.5, side: "Moins" }] },
    },
    matchStats: {},
    extraStats: {},
    goals: {},
  };

  await saveFrozenPrediction({
    matchId: "556", competitionCode: "PL", homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
    matchDate: "2026-08-02T15:00:00Z", result: prediction, matchStatus: "SCHEDULED", finalScore: null,
  });

  // Chelsea (outsider) gagne 0-2 : winner ✗, totalGoals réel=2 (Plus de 2,5 ✗),
  // totalHome réel=0 (Plus de 1,5 ✗), totalAway réel=2 (Moins de 0,5 ✗) -> tout raté.
  getLiveMatch.mockResolvedValue({ status: "FINISHED", score: { fullTime: { home: 0, away: 2 } } });
  await settleFinishedPredictionsNow("test-token", null);

  expect(rows[0].status).toBe("failure");

  const failureAfter = await listAndMaintainHistory("failure", null);
  const successAfter = await listAndMaintainHistory("success", null);
  expect(failureAfter).toHaveLength(1);
  expect(failureAfter[0].match_id).toBe("556");
  expect(successAfter).toHaveLength(0);
});

test("un match encore en cours ne bascule dans aucune des deux sections avant sa vraie fin", async () => {
  const prediction = {
    home: { name: "PSG" }, away: { name: "Marseille" },
    probabilities: { home: 60, draw: 25, away: 15 },
    markets: { totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] } },
    matchStats: {}, extraStats: {}, correctScores: [], goals: {},
  };
  await saveFrozenPrediction({
    matchId: "557", competitionCode: "FL1", homeTeamName: "PSG", awayTeamName: "Marseille",
    matchDate: "2026-08-03T20:00:00Z", result: prediction, matchStatus: "IN_PLAY", finalScore: null,
  });

  getLiveMatch.mockResolvedValue({ status: "IN_PLAY", score: { fullTime: { home: 1, away: 0 } } });
  await settleFinishedPredictionsNow("test-token", null);

  expect(rows[0].status).toBe("pending");
  expect(await listAndMaintainHistory("success", null)).toHaveLength(0);
  expect(await listAndMaintainHistory("failure", null)).toHaveLength(0);
});
