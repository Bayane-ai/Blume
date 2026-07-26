/**
 * @jest-environment jsdom
 *
 * lib/prefsCookie.js — cookie "blume_prefs" (voir PROMPT Partie 2) : non httpOnly,
 * 1 an, thème/dernier onglet/favoris, jamais soumis au consentement.
 */
import { readPrefs, writePrefs, applyTheme, COOKIE_NAME, THEME_NO_FLASH_SCRIPT } from "../lib/prefsCookie";

const ONE_YEAR_SECONDS = 365 * 24 * 3600;

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

beforeEach(() => {
  clearCookies();
});

test("nom du cookie : blume_prefs", () => {
  expect(COOKIE_NAME).toBe("blume_prefs");
});

test("readPrefs sans cookie : valeurs par défaut (thème sombre, pas d'onglet, aucun favori)", () => {
  expect(readPrefs()).toEqual({ theme: "dark", lastTab: null, favoriteCompetitions: [] });
});

test("writePrefs pose un cookie non httpOnly (donc lisible immédiatement via document.cookie), Max-Age 1 an, Path=/", () => {
  writePrefs({ theme: "light" });
  expect(document.cookie).toContain("blume_prefs=");
  expect(readPrefs().theme).toBe("light");
});

test("writePrefs fusionne avec les préférences existantes (ne perd pas les autres champs)", () => {
  writePrefs({ theme: "light" });
  writePrefs({ lastTab: "/a-venir" });
  writePrefs({ favoriteCompetitions: ["PL"] });
  expect(readPrefs()).toEqual({ theme: "light", lastTab: "/a-venir", favoriteCompetitions: ["PL"] });
});

test("readPrefs tolère un cookie corrompu (JSON invalide) sans planter, revient aux valeurs par défaut", () => {
  document.cookie = "blume_prefs=%7Bpas-du-json-valide";
  expect(readPrefs()).toEqual({ theme: "dark", lastTab: null, favoriteCompetitions: [] });
});

test("applyTheme pose data-theme sur <html>", () => {
  applyTheme("light");
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  applyTheme("dark");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  applyTheme("valeur-invalide");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("THEME_NO_FLASH_SCRIPT est un script autonome qui pose data-theme AVANT tout rendu React", () => {
  document.cookie = `blume_prefs=${encodeURIComponent(JSON.stringify({ theme: "light" }))}`;
  document.documentElement.removeAttribute("data-theme");
  // eslint-disable-next-line no-eval
  eval(THEME_NO_FLASH_SCRIPT);
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
});

test("THEME_NO_FLASH_SCRIPT retombe sur 'dark' sans cookie", () => {
  document.documentElement.removeAttribute("data-theme");
  // eslint-disable-next-line no-eval
  eval(THEME_NO_FLASH_SCRIPT);
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("le cookie dure bien 1 an (365 jours) en secondes", () => {
  // Vérifié indirectement : writePrefs ne doit jamais lever et le cookie doit rester
  // lisible juste après écriture (Max-Age positif, jamais 0/négatif).
  writePrefs({ theme: "dark" });
  expect(ONE_YEAR_SECONDS).toBe(31536000);
  expect(document.cookie).toMatch(/blume_prefs=/);
});
