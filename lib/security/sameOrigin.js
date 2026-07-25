// Protection CSRF pour les routes de MUTATION (POST/PUT/PATCH/DELETE) de ce site :
// toutes les écritures sont déclenchées depuis le navigateur via `fetch()` en
// same-origin (jamais un formulaire HTML classique soumis depuis un autre site) — la
// défense standard et suffisante dans ce cas est de vérifier que la requête vient bien
// du MÊME site (en-tête Origin, avec repli sur Referer si Origin est absent, ce que
// font certains navigateurs/anciens clients pour les requêtes same-origin), plutôt
// qu'un jeton CSRF à générer/valider en plus (inutile ici : aucune session n'est
// transmise par cookie tiers lisible par un autre site sans passer par le navigateur
// de la victime, et ce contrôle bloque justement ce cas).
//
// Refuse par défaut : une requête SANS Origin ET SANS Referer (donc impossible à
// vérifier) est refusée plutôt qu'acceptée par prudence — un vrai navigateur envoie
// toujours au moins l'un des deux pour une requête fetch() same-origin.
function siteOrigin(req) {
  // NEXT_PUBLIC_SITE_URL (si définie) prime : utile en développement/preview où
  // l'hôte réel diffère du domaine de production. À défaut, déduit l'origine
  // attendue directement de la requête elle-même (hôte demandé), ce qui reste correct
  // tant que la requête n'a pas déjà été falsifiée au niveau de l'en-tête Host — les
  // en-têtes Origin/Referer, eux, sont fixés par le NAVIGATEUR de l'appelant (jamais
  // falsifiables depuis du JavaScript cross-origin), donc la comparaison reste sûre.
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const headers = req.headers || {};
  const proto = headers["x-forwarded-proto"] || "https";
  const host = headers.host;
  return host ? `${proto}://${host}` : null;
}

function originFromHeader(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(req) {
  const expected = siteOrigin(req);
  if (!expected) return false;

  const headers = req.headers || {};
  const origin = originFromHeader(headers.origin);
  if (origin) return origin === expected;

  const referer = originFromHeader(headers.referer);
  if (referer) return referer === expected;

  // Ni Origin ni Referer : ne jamais autoriser par défaut.
  return false;
}
