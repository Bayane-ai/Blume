/**
 * lib/personalization.js — n'est plus qu'un simple enrobage de fetch() vers
 * pages/api/search-history.js et pages/api/favorites.js (voir PROMPT point 6 :
 * "jamais un appel Supabase direct depuis le navigateur") : toute la vraie logique
 * (filtrage par profile_id) vit désormais côté serveur, testée directement dans
 * __tests__/personalization-api.test.js. Ce fichier-ci vérifie seulement le
 * comportement du client : bons appels, garde-fous, jamais de plantage.
 */
import {
  getRecentSearches, saveSearch,
  getFavoriteCompetitionCodes, addFavoriteCompetition, removeFavoriteCompetition,
} from "../lib/personalization";

const USER = "user-1";

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
});

test("sans userId, aucune fonction ne fait le moindre appel réseau", async () => {
  expect(await getRecentSearches(null)).toEqual([]);
  await saveSearch(null, "arsenal");
  expect(await getFavoriteCompetitionCodes(null)).toEqual(new Set());
  await addFavoriteCompetition(null, "PL", "Premier League");
  await removeFavoriteCompetition(null, "PL");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("getRecentSearches appelle GET /api/search-history et renvoie les requêtes reçues", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ queries: ["arsenal", "chelsea"] }) }));
  expect(await getRecentSearches(USER)).toEqual(["arsenal", "chelsea"]);
  expect(global.fetch).toHaveBeenCalledWith("/api/search-history");
});

test("saveSearch appelle POST /api/search-history avec la requête, jamais si trop courte", async () => {
  await saveSearch(USER, "a");
  expect(global.fetch).not.toHaveBeenCalled();

  await saveSearch(USER, "arsenal");
  expect(global.fetch).toHaveBeenCalledWith("/api/search-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "arsenal" }),
  });
});

test("getFavoriteCompetitionCodes appelle GET /api/favorites et renvoie un Set des codes reçus", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ codes: ["PL", "PD"] }) }));
  expect(await getFavoriteCompetitionCodes(USER)).toEqual(new Set(["PL", "PD"]));
});

test("addFavoriteCompetition appelle POST /api/favorites", async () => {
  await addFavoriteCompetition(USER, "PL", "Premier League");
  expect(global.fetch).toHaveBeenCalledWith("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "PL", label: "Premier League" }),
  });
});

test("removeFavoriteCompetition appelle DELETE /api/favorites", async () => {
  await removeFavoriteCompetition(USER, "PL");
  expect(global.fetch).toHaveBeenCalledWith("/api/favorites", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "PL" }),
  });
});

test("échec réseau : jamais une exception non gérée, listes/Set vides en repli", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("network down")));
  expect(await getRecentSearches(USER)).toEqual([]);
  expect(await getFavoriteCompetitionCodes(USER)).toEqual(new Set());
  await expect(saveSearch(USER, "arsenal")).resolves.toBeUndefined();
  await expect(addFavoriteCompetition(USER, "PL")).resolves.toBeUndefined();
  await expect(removeFavoriteCompetition(USER, "PL")).resolves.toBeUndefined();
});
