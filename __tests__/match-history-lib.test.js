/**
 * lib/matchHistory.js — historique personnel (Supabase, table match_history, Row
 * Level Security auth.uid() = user_id) des matchs dont un COMPTE a déjà ouvert
 * l'analyse/les pronostics (voir PROMPT Bloc 4 "chaque utilisateur ne voit QUE ses
 * propres données") : ajout en tête (upsert sur user_id+match_id, jamais de doublon),
 * jamais effacé par la fin du match, effacement automatique ~10 jours après avoir été
 * consulté, toujours filtré par le VRAI user_id du compte connecté.
 */
import { supabase } from "../lib/supabaseClient";
import { addMatchToHistory, listMatchHistory } from "../lib/matchHistory";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));

// Simule une table Postgres en mémoire, assez fidèle à supabase-js pour exercer la
// vraie logique de lib/matchHistory.js (upsert = ajoute ou met à jour selon
// onConflict, delete/select avec filtres eq/lt/order) — jamais un simple mock de
// retour fixe, puisque ce sont justement le dédoublonnage/tri/expiration qui sont
// testés ici.
let rows;

function makeFromMock() {
  return jest.fn((table) => {
    if (table !== "match_history") throw new Error(`table inattendue dans le test : ${table}`);
    return {
      upsert: (row, opts) => {
        const conflictCols = (opts?.onConflict || "").split(",");
        const idx = rows.findIndex((r) => conflictCols.every((c) => r[c] === row[c]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
        else rows.push({ ...row });
        return Promise.resolve({ error: null });
      },
      delete: () => {
        const filters = [];
        const builder = {
          eq: (col, val) => { filters.push(["eq", col, val]); return builder; },
          lt: (col, val) => { filters.push(["lt", col, val]); return builder; },
          then: (resolve) => {
            rows = rows.filter((r) => !filters.every(([op, col, val]) => (op === "eq" ? r[col] === val : r[col] < val)));
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return builder;
      },
      select: () => {
        const filters = [];
        let orderCol = null;
        let ascending = true;
        const builder = {
          eq: (col, val) => { filters.push([col, val]); return builder; },
          order: (col, o) => { orderCol = col; ascending = !!o?.ascending; return builder; },
          then: (resolve) => {
            let result = rows.filter((r) => filters.every(([col, val]) => r[col] === val));
            if (orderCol) {
              result = [...result].sort((a, b) => {
                if (a[orderCol] === b[orderCol]) return 0;
                const cmp = a[orderCol] > b[orderCol] ? 1 : -1;
                return ascending ? cmp : -cmp;
              });
            }
            return Promise.resolve({ data: result, error: null }).then(resolve);
          },
        };
        return builder;
      },
    };
  });
}

function entry(overrides = {}) {
  return {
    id: 1,
    status: "SCHEDULED",
    minute: null,
    utcDate: "2026-01-01T15:00:00Z",
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
    score: { fullTime: { home: null, away: null } },
    ...overrides,
  };
}

const USER = "user-1";
const OTHER_USER = "user-2";

beforeEach(() => {
  rows = [];
  supabase.from = makeFromMock();
  jest.restoreAllMocks();
});

test("un compte sans entrée d'historique renvoie une liste vide", async () => {
  expect(await listMatchHistory(USER)).toEqual([]);
});

test("sans userId, ne lit ni n'écrit rien (jamais un historique anonyme)", async () => {
  await addMatchToHistory(null, entry());
  expect(await listMatchHistory(null)).toEqual([]);
  expect(rows).toHaveLength(0);
});

test("ajouter un match l'ajoute en tête de l'historique DE CE COMPTE avec un horodatage réel", async () => {
  await addMatchToHistory(USER, entry({ id: 1 }));
  const list = await listMatchHistory(USER);
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe("1");
  expect(list[0].homeTeam.name).toBe("Arsenal FC");
  expect(Number.isFinite(list[0].addedAt)).toBe(true);
});

// Des insertions réelles très rapprochées peuvent tomber sur la même milliseconde
// (added_at identique) : on force ici des horodatages distincts mais PROCHES
// D'AUJOURD'HUI (jamais périmés par le nettoyage à 10 jours de listMatchHistory), pour
// tester l'ORDRE sans dépendre de la vitesse d'exécution du test.
function mockNextAddedAt(secondsFromNow) {
  const iso = new Date(Date.now() + secondsFromNow * 1000).toISOString();
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(iso);
}

test("les matchs ajoutés ensuite passent en tête de liste (plus récent en premier)", async () => {
  mockNextAddedAt(0);
  await addMatchToHistory(USER, entry({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } }));
  mockNextAddedAt(1);
  await addMatchToHistory(USER, entry({ id: 2, homeTeam: { id: 20, name: "Real Madrid", crest: "" } }));
  jest.restoreAllMocks();

  const list = await listMatchHistory(USER);
  expect(list.map((e) => e.id)).toEqual(["2", "1"]);
});

test("rouvrir un match déjà présent le remonte en haut au lieu de créer un doublon", async () => {
  mockNextAddedAt(0);
  await addMatchToHistory(USER, entry({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } }));
  mockNextAddedAt(1);
  await addMatchToHistory(USER, entry({ id: 2, homeTeam: { id: 20, name: "Real Madrid", crest: "" } }));
  mockNextAddedAt(2);
  await addMatchToHistory(USER, entry({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } }));
  jest.restoreAllMocks();

  const list = await listMatchHistory(USER);
  expect(list).toHaveLength(2);
  expect(list.map((e) => e.id)).toEqual(["1", "2"]);
});

test("rouvrir un match déjà présent remet son délai d'effacement à zéro (nouvel addedAt)", async () => {
  const oldTimestamp = Date.now() - 5 * 24 * 3600 * 1000; // il y a 5 jours
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(new Date(oldTimestamp).toISOString());
  await addMatchToHistory(USER, entry({ id: 1 }));
  jest.restoreAllMocks();

  const beforeReopen = await listMatchHistory(USER);
  expect(beforeReopen[0].addedAt).toBe(oldTimestamp);

  await addMatchToHistory(USER, entry({ id: 1 })); // reconsulté maintenant
  const afterReopen = await listMatchHistory(USER);
  expect(afterReopen[0].addedAt).toBeGreaterThan(oldTimestamp);
});

test("un match reste dans l'historique même une fois terminé (pas effacé par la fin du match)", async () => {
  await addMatchToHistory(USER, entry({ id: 1, status: "SCHEDULED" }));
  const list = await listMatchHistory(USER);
  expect(list).toHaveLength(1);
});

test("une entrée disparaît automatiquement après ~10 jours", async () => {
  const tenDaysAgo = new Date(Date.now() - 10.5 * 24 * 3600 * 1000).toISOString();
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(tenDaysAgo);
  await addMatchToHistory(USER, entry({ id: 1 }));
  jest.restoreAllMocks();

  expect(await listMatchHistory(USER)).toEqual([]);
});

test("une entrée de moins de 10 jours reste dans l'historique", async () => {
  const nineDaysAgo = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(nineDaysAgo);
  await addMatchToHistory(USER, entry({ id: 1 }));
  jest.restoreAllMocks();

  expect(await listMatchHistory(USER)).toHaveLength(1);
});

test("une entrée sans identifiant, sans équipe domicile ou sans équipe extérieure n'est jamais ajoutée (rien d'inventé)", async () => {
  await addMatchToHistory(USER, entry({ id: null }));
  await addMatchToHistory(USER, entry({ homeTeam: null }));
  await addMatchToHistory(USER, entry({ awayTeam: null }));
  await addMatchToHistory(USER, null);
  expect(await listMatchHistory(USER)).toEqual([]);
});

// Bloc 4 — isolation entre comptes : jamais l'historique d'un autre utilisateur.
test("l'historique d'un compte n'apparaît jamais dans celui d'un autre compte", async () => {
  await addMatchToHistory(USER, entry({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } }));
  await addMatchToHistory(OTHER_USER, entry({ id: 2, homeTeam: { id: 20, name: "Real Madrid", crest: "" } }));

  const mine = await listMatchHistory(USER);
  const theirs = await listMatchHistory(OTHER_USER);
  expect(mine.map((e) => e.id)).toEqual(["1"]);
  expect(theirs.map((e) => e.id)).toEqual(["2"]);
});
