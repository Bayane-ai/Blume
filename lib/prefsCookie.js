// Cookie "blume_prefs" (voir PROMPT, Partie 2 — "Cookies de préférences") : thème
// (clair/sombre), dernier onglet consulté, compétitions favorites en cache
// d'affichage. Contrairement au cookie de session (lib/session.js), CELUI-CI est
// géré entièrement côté navigateur (document.cookie) : non httpOnly par nature
// (lisible/modifiable par le JavaScript du site — aucune donnée sensible dedans,
// seulement des préférences d'affichage), 1 an de durée. Considéré comme un cookie
// STRICTEMENT NÉCESSAIRE au même titre que la session (voir PROMPT Partie 3 :
// "si l'utilisateur refuse, seuls les cookies de session et de préférences restent
// actifs") : jamais soumis au consentement, jamais bloqué par un refus.
const COOKIE_NAME = "blume_prefs";
const ONE_YEAR_SECONDS = 365 * 24 * 3600;

const DEFAULT_PREFS = { theme: "dark", lastTab: null, favoriteCompetitions: [] };

function parseCookieValue(raw) {
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return {
      theme: parsed?.theme === "light" ? "light" : "dark",
      lastTab: typeof parsed?.lastTab === "string" ? parsed.lastTab : null,
      favoriteCompetitions: Array.isArray(parsed?.favoriteCompetitions) ? parsed.favoriteCompetitions : [],
    };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

// Lit les préférences depuis document.cookie — renvoie toujours un objet complet
// (valeurs par défaut si le cookie est absent/corrompu), jamais une exception.
export function readPrefs() {
  if (typeof document === "undefined") return { ...DEFAULT_PREFS };
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match) return { ...DEFAULT_PREFS };
  return parseCookieValue(match[1]);
}

// Fusionne `partial` dans les préférences existantes et réécrit le cookie entier
// (1 an, Path=/, SameSite=Lax, Secure uniquement si servi en https — un cookie
// Secure sur http://localhost ne serait simplement jamais posé par le navigateur,
// contrairement au cookie de session qui, lui, est posé par le SERVEUR et bénéficie
// de l'exception "localhost = origine de confiance" des navigateurs).
export function writePrefs(partial) {
  if (typeof document === "undefined") return { ...DEFAULT_PREFS };
  const next = { ...readPrefs(), ...partial };
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  document.cookie = [
    `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(next))}`,
    `Max-Age=${ONE_YEAR_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    isHttps ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
  return next;
}

// Applique le thème sur <html data-theme="..."> — utilisé à la fois par le script
// bloquant de pages/_document.js (avant tout rendu React, voir PROMPT "avant le
// premier rendu") et par le sélecteur de thème dans pages/reglages.js (changement à
// chaud, sans recharger la page).
export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
}

// Script injecté tel quel (texte brut, voir pages/_document.js) — DOIT rester
// autonome (aucun accès à des modules importés : il s'exécute avant tout bundle JS)
// et strictement synchrone pour s'exécuter avant la première peinture de la page.
export const THEME_NO_FLASH_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${COOKIE_NAME}=([^;]*)/);var theme="dark";if(m){var p=JSON.parse(decodeURIComponent(m[1]));if(p&&p.theme==="light")theme="light";}document.documentElement.setAttribute("data-theme",theme);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;

export { COOKIE_NAME, DEFAULT_PREFS };
