/**
 * @jest-environment jsdom
 *
 * L'historique de recherche et les favoris sont personnels à chaque compte
 * (voir lib/personalization.js, protégé par RLS côté Supabase). Ces tests vérifient
 * le câblage côté UI : suggestions de recherche cliquables, sauvegarde après une
 * pause de frappe, et bascule des favoris de compétition.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import Home from "../pages/index";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: "user-1", email: "test@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
  },
}));

const getRecentSearches = jest.fn();
const saveSearch = jest.fn();
const getFavoriteCompetitionCodes = jest.fn();
const addFavoriteCompetition = jest.fn();
const removeFavoriteCompetition = jest.fn();

jest.mock("../lib/personalization", () => ({
  getRecentSearches: (...a) => getRecentSearches(...a),
  saveSearch: (...a) => saveSearch(...a),
  getFavoriteCompetitionCodes: (...a) => getFavoriteCompetitionCodes(...a),
  addFavoriteCompetition: (...a) => addFavoriteCompetition(...a),
  removeFavoriteCompetition: (...a) => removeFavoriteCompetition(...a),
}));

function mockFetchRouter() {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.startsWith("/api/matches")) {
      return Promise.resolve({ json: () => Promise.resolve({ competitions: [] }) });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

beforeEach(() => {
  mockFetchRouter();
  getRecentSearches.mockReset().mockResolvedValue(["arsenal"]);
  saveSearch.mockReset().mockResolvedValue();
  getFavoriteCompetitionCodes.mockReset().mockResolvedValue(new Set());
  addFavoriteCompetition.mockReset().mockResolvedValue();
  removeFavoriteCompetition.mockReset().mockResolvedValue();
});

test("les recherches récentes du compte s'affichent en suggestions cliquables, propres à ce compte", async () => {
  render(<Home />);

  const chip = await screen.findByRole("button", { name: "arsenal" });
  expect(getRecentSearches).toHaveBeenCalledWith("user-1");

  fireEvent.click(chip);
  expect(screen.getByPlaceholderText(/rechercher une équipe/i)).toHaveValue("arsenal");
});

test("taper une recherche la sauvegarde sur le compte après une pause (pas à chaque frappe)", async () => {
  render(<Home />);
  await screen.findByRole("button", { name: "arsenal" });

  const input = screen.getByPlaceholderText(/rechercher une équipe/i);
  fireEvent.change(input, { target: { value: "liverpool" } });

  expect(saveSearch).not.toHaveBeenCalled();

  await act(async () => {
    await new Promise((r) => setTimeout(r, 900));
  });

  expect(saveSearch).toHaveBeenCalledWith("user-1", "liverpool");
});

// Le bouton "Compétitions" (et donc les favoris de compétition depuis l'accueil) a
// été retiré de la navigation par PROMPT 2 — voir lib/personalization.js pour les
// fonctions elles-mêmes, toujours disponibles pour l'étape 6 du plan (retour des
// boutons de compétitions).
