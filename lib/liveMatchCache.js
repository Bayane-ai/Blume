// Cache en mémoire très court (quelques secondes) de l'état d'un match, PARTAGÉ entre
// tous les visiteurs. Le token football-data.org est le même pour tout le site : si
// plusieurs personnes suivent le même match en même temps, chacune actualisant toutes
// les quelques secondes, ça peut vite dépasser le quota de 10 requêtes/minute — l'API
// se met alors à répondre en erreur, et le pronostic retombe silencieusement sur
// l'estimation pré-match au lieu de suivre le score réel. Ce cache fait qu'un seul appel
// en amont est nécessaire par fenêtre de quelques secondes, quel que soit le nombre de
// visiteurs (y compris s'ils arrivent au même instant, via la déduplication des
// requêtes en cours), donc chacun peut actualiser souvent sans jamais dépasser le quota.
const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 4000; // 4s

const cache = new Map(); // matchId -> { match, fetchedAt }
const inFlight = new Map(); // matchId -> promesse en cours

export async function getLiveMatch(matchId, token) {
  if (!matchId) return null;

  const cached = cache.get(matchId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.match;
  }

  const pending = inFlight.get(matchId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const r = await fetch(`${BASE}/matches/${matchId}`, { headers: { "X-Auth-Token": token } });
      if (!r.ok) return cached ? cached.match : null;
      const data = await r.json();
      const match = data?.match || data;
      cache.set(matchId, { match, fetchedAt: Date.now() });
      return match;
    } catch {
      return cached ? cached.match : null;
    } finally {
      inFlight.delete(matchId);
    }
  })();

  inFlight.set(matchId, promise);
  return promise;
}
