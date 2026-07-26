// Cookie "blume_consent" (voir PROMPT Partie 3 — "Bandeau de consentement") : mémorise
// le choix de la personne ("all" = tout accepter, "essential" = refuser les cookies
// non essentiels), 6 mois. Purement côté navigateur, comme lib/prefsCookie.js — ce
// choix n'a rien de sensible et n'a pas besoin d'un aller-retour serveur.
//
// Ce site ne dépose aujourd'hui AUCUN cookie de mesure d'audience ni de publicité
// (aucun script analytics/pixel nulle part dans le code) : le cookie de session
// (lib/session.js) et le cookie de préférences (lib/prefsCookie.js) sont tous deux
// strictement nécessaires et restent actifs quel que soit le choix, exactement comme
// demandé. `hasNonEssentialConsent()` existe pour que toute future intégration de
// mesure/publicité puisse s'y conditionner AVANT de déposer quoi que ce soit — tant
// qu'aucune telle intégration n'existe, refuser ne change rien de plus que la valeur
// de ce cookie lui-même.
const COOKIE_NAME = "blume_consent";
const SIX_MONTHS_SECONDS = 182 * 24 * 3600;

function readCookieRaw(name) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name, value, maxAgeSeconds) {
  if (typeof document === "undefined") return;
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  document.cookie = [
    `${name}=${value}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "SameSite=Lax",
    isHttps ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

// "all" | "essential" | null (aucun choix fait pour l'instant — le bandeau doit
// s'afficher).
export function readConsent() {
  const raw = readCookieRaw(COOKIE_NAME);
  return raw === "all" || raw === "essential" ? raw : null;
}

export function writeConsent(value) {
  if (value !== "all" && value !== "essential") return;
  writeCookie(COOKIE_NAME, value, SIX_MONTHS_SECONDS);
}

// Efface le choix (voir "réglages du compte" — revenir sur son choix) : le bandeau
// réapparaît à la prochaine vérification.
export function clearConsent() {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
}

export function hasNonEssentialConsent() {
  return readConsent() === "all";
}

// Signal applicatif (voir components/CookieBanner.js et pages/reglages.js) pour faire
// réapparaître le bandeau sans recharger la page quand on clique "Modifier mes
// préférences de cookies".
export const CONSENT_RESET_EVENT = "blume:consent-reset";

export function requestConsentReset() {
  clearConsent();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONSENT_RESET_EVENT));
}

export { COOKIE_NAME };
