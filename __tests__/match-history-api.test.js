/**
 * pages/api/match-history.js — historique personnel des matchs consultés, filtré par
 * profile_id (voir supabase/migrations/0008_custom_auth.sql) : ajout en tête (upsert
 * sur profile_id+match_id, jamais de doublon), jamais effacé par la fin du match,
 * effacement automatique ~10 jours après avoir été consultée, TOUJOURS filtré par le
 * profile_id de LA SESSION — jamais un identifiant fourni par le client (voir PROMPT
 * point 6 : "Toutes les lectures/écritures passent par le serveur, filtrées sur le
 * profile_id de la session"). C'est ICI, au niveau de la route, que l'isolation entre
 * deux comptes se vérifie réellement : deux sessions différentes, jamais un simple id
 * passé en paramètre par un client qui pourrait le falsifier.
 */
import handler from "../pages/api/match-history";

let mockSession = null;
jest.mock("../lib/session", () => ({
  getSession: () => mockSession,
}));

jest.mock("../lib/security/guardMutation", () => ({ guardMutation: () => true }));

// Simule la table match_history EN MÉMOIRE, assez fidèle à supabase-js pour exercer
// la vraie logique de la route (upsert = ajoute ou met à jour selon onConflict,
// delete/select avec filtres eq/lt/order).
let rows;

jest.mock("../lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table) => {
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
    },
  }),
}));

function entry(overrides = {}) {
  return {
    id: 1, status: "SCHEDULED", minute: null, utcDate: "2026-01-01T15:00:00Z",
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
    score: { fullTime: { home: null, away: null } },
    ...overrides,
  };
}

function mockReqRes({ method = "GET", body } = {}) {
  const req = { method, body, headers: {}, cookies: {}, socket: {} };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

async function add(entryOverrides) {
  const { req, res } = mockReqRes({ method: "POST", body: { entry: entry(entryOverrides) } });
  await handler(req, res);
  return res;
}

async function list() {
  const { req, res } = mockReqRes({ method: "GET" });
  await handler(req, res);
  return res.body.items;
}

function mockNextAddedAt(secondsFromNow) {
  const iso = new Date(Date.now() + secondsFromNow * 1000).toISOString();
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(iso);
}

const SESSION_A = { id: "profile-a", email: "alice@example.com" };
const SESSION_B = { id: "profile-b", email: "bob@example.com" };

beforeEach(() => {
  rows = [];
  jest.restoreAllMocks();
  mockSession = SESSION_A;
});

test("aucune session : 401, jamais d'accès aux données", async () => {
  mockSession = null;
  const { req, res } = mockReqRes({ method: "GET" });
  await handler(req, res);
  expect(res.statusCode).toBe(401);
});

test("un compte sans entrée d'historique renvoie une liste vide", async () => {
  expect(await list()).toEqual([]);
});

test("ajouter un match l'ajoute en tête de l'historique DE CE COMPTE avec un horodatage réel", async () => {
  await add({ id: 1 });
  const items = await list();
  expect(items).toHaveLength(1);
  expect(items[0].id).toBe("1");
  expect(items[0].homeTeam.name).toBe("Arsenal FC");
  expect(Number.isFinite(items[0].addedAt)).toBe(true);
});

test("les matchs ajoutés ensuite passent en tête de liste (plus récent en premier)", async () => {
  mockNextAddedAt(0);
  await add({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } });
  mockNextAddedAt(1);
  await add({ id: 2, homeTeam: { id: 20, name: "Real Madrid", crest: "" } });
  jest.restoreAllMocks();

  const items = await list();
  expect(items.map((e) => e.id)).toEqual(["2", "1"]);
});

test("rouvrir un match déjà présent le remonte en haut au lieu de créer un doublon", async () => {
  mockNextAddedAt(0);
  await add({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } });
  mockNextAddedAt(1);
  await add({ id: 2, homeTeam: { id: 20, name: "Real Madrid", crest: "" } });
  mockNextAddedAt(2);
  await add({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } });
  jest.restoreAllMocks();

  const items = await list();
  expect(items).toHaveLength(2);
  expect(items.map((e) => e.id)).toEqual(["1", "2"]);
});

test("une entrée disparaît automatiquement après ~10 jours", async () => {
  const tenDaysAgo = new Date(Date.now() - 10.5 * 24 * 3600 * 1000).toISOString();
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(tenDaysAgo);
  await add({ id: 1 });
  jest.restoreAllMocks();

  expect(await list()).toEqual([]);
});

test("une entrée de moins de 10 jours reste dans l'historique", async () => {
  const nineDaysAgo = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();
  jest.spyOn(Date.prototype, "toISOString").mockReturnValueOnce(nineDaysAgo);
  await add({ id: 1 });
  jest.restoreAllMocks();

  expect(await list()).toHaveLength(1);
});

test("une entrée sans identifiant, sans équipe domicile ou sans équipe extérieure est refusée (400), rien d'inventé", async () => {
  const res1 = await add({ id: null });
  expect(res1.statusCode).toBe(400);
  const res2 = await add({ homeTeam: null });
  expect(res2.statusCode).toBe(400);
  expect(await list()).toEqual([]);
});

// Le test clé de ce fichier : l'isolation ne dépend JAMAIS d'un id fourni par le
// client, seulement de la session réellement authentifiée.
test("l'historique d'un compte n'apparaît jamais dans celui d'un autre compte (isolation par SESSION, pas par un id client)", async () => {
  mockSession = SESSION_A;
  await add({ id: 1, homeTeam: { id: 10, name: "Arsenal FC", crest: "" } });

  mockSession = SESSION_B;
  await add({ id: 2, homeTeam: { id: 20, name: "Real Madrid", crest: "" } });

  mockSession = SESSION_A;
  const mine = await list();
  expect(mine.map((e) => e.id)).toEqual(["1"]);

  mockSession = SESSION_B;
  const theirs = await list();
  expect(theirs.map((e) => e.id)).toEqual(["2"]);
});
