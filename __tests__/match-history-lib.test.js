/**
 * lib/matchHistory.js — n'est plus qu'un simple enrobage de fetch() vers
 * pages/api/match-history.js (voir PROMPT point 6 : "jamais un appel Supabase direct
 * depuis le navigateur") : toute la vraie logique (upsert/dédoublonnage/tri/
 * expiration à 10 jours/isolation par profile_id) vit désormais côté serveur et est
 * testée directement dans __tests__/match-history-api.test.js. Ce fichier-ci vérifie
 * seulement le comportement du client : bons appels, garde-fous, jamais de plantage.
 */
import { addMatchToHistory, listMatchHistory } from "../lib/matchHistory";

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

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) }));
});

test("sans userId, ne fait aucun appel réseau (jamais un historique anonyme)", async () => {
  await addMatchToHistory(null, entry());
  expect(await listMatchHistory(null)).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("une entrée sans identifiant, sans équipe domicile ou sans équipe extérieure n'est jamais envoyée (rien d'inventé)", async () => {
  await addMatchToHistory(USER, entry({ id: null }));
  await addMatchToHistory(USER, entry({ homeTeam: null }));
  await addMatchToHistory(USER, entry({ awayTeam: null }));
  await addMatchToHistory(USER, null);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("ajouter un match appelle POST /api/match-history avec l'entrée telle quelle", async () => {
  await addMatchToHistory(USER, entry({ id: 1 }));
  expect(global.fetch).toHaveBeenCalledWith("/api/match-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: entry({ id: 1 }) }),
  });
});

test("lister l'historique appelle GET /api/match-history et renvoie les items reçus", async () => {
  const items = [{ id: "1", homeTeam: { name: "Arsenal FC" } }];
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) }));

  expect(await listMatchHistory(USER)).toEqual(items);
  expect(global.fetch).toHaveBeenCalledWith("/api/match-history");
});

test("échec réseau à l'ajout : journalisé mais jamais une exception non gérée", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("network down")));
  await expect(addMatchToHistory(USER, entry())).resolves.toBeUndefined();
});

test("échec réseau à la lecture : renvoie une liste vide, jamais une exception non gérée", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("network down")));
  expect(await listMatchHistory(USER)).toEqual([]);
});

test("réponse HTTP en erreur (401 session expirée) : renvoie une liste vide, jamais une exception", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: "Non connecté." }) }));
  expect(await listMatchHistory(USER)).toEqual([]);
});
