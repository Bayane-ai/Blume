// Même principe que liveMatchCache.js, mais pour la liste globale des matchs en
// direct : un seul appel en amont par fenêtre de quelques secondes, partagé par tous
// les visiteurs de l'onglet "Matchs en ligne", au lieu d'un appel par visiteur.
const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 4000; // 4s

let cachedResult = null; // { matches } | { errorStatus }
let cachedAt = 0;
let inFlight = null; // promesse en cours, pour que des requêtes simultanées (plusieurs
// visiteurs qui actualisent au même instant) partagent le même appel en amont au lieu
// d'en déclencher un chacune.

export async function getLiveMatchesList(token) {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const r = await fetch(`${BASE}/matches?status=LIVE&limit=100`, {
        headers: { "X-Auth-Token": token },
      });
      if (!r.ok) {
        // En cas d'erreur passagère (quota, réseau), on préfère resservir la dernière
        // liste connue plutôt que de faire disparaître tous les matchs à l'écran.
        if (cachedResult && cachedResult.matches) return cachedResult;
        cachedResult = { errorStatus: r.status };
        cachedAt = Date.now();
        return cachedResult;
      }
      const data = await r.json();
      cachedResult = { matches: data.matches || [] };
      cachedAt = Date.now();
      return cachedResult;
    } catch (e) {
      if (cachedResult && cachedResult.matches) return cachedResult;
      cachedResult = { errorStatus: 500 };
      cachedAt = Date.now();
      return cachedResult;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
