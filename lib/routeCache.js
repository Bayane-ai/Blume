// Cache serveur de 60 s par sport (demandé) — protège le quota des fournisseurs quand
// plusieurs visiteurs (ou l'auto-rafraîchissement de la page) frappent la même route
// en rafale.
//
// Deux étages complémentaires, volontairement :
//   1. ce cache mémoire, qui coupe les appels répétés DANS une même instance chaude ;
//   2. l'en-tête Cache-Control s-maxage=60 posé par les routes, qui mutualise la
//      réponse au niveau du CDN entre TOUTES les instances et tous les visiteurs.
// L'étage 1 seul serait inutile sur une instance froide, l'étage 2 seul ne protège pas
// des appels internes (endpoint de contrôle, rendu serveur).
//
// Une réponse en ERREUR n'est jamais mise en cache : sinon une panne passagère de 2
// secondes figerait le sport pendant une minute entière — c'est précisément ce qui
// avait gelé le basket sur « aucun match » (voir lib/sports/basketball/provider.js).
const TTL_MS = 60 * 1000;
const store = new Map();

export function readRouteCache(key, { now = Date.now() } = {}) {
  const entry = store.get(key);
  if (!entry) return null;
  if (now - entry.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function writeRouteCache(key, value, { now = Date.now() } = {}) {
  store.set(key, { at: now, value });
  return value;
}

export function clearRouteCache() {
  store.clear();
}

export const ROUTE_CACHE_TTL_MS = TTL_MS;
