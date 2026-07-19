// Historique réel des confrontations directes entre les deux équipes d'un match,
// via l'endpoint football-data.org dédié (/matches/{id}/head2head) — une des trois
// sources de données du modèle de pronostic (avec le classement/la forme récente),
// voir lib/pronostic.js. Cache 30 minutes par match (cet historique ne change pas
// pendant la durée de vie d'une page pronostics) + déduplication des requêtes en
// cours (même principe que lib/liveMatchCache.js) : plusieurs visiteurs qui ouvrent
// le même match au même instant ne déclenchent qu'un seul appel réel en amont.
const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 30 * 60 * 1000;
const LIMIT = 10;

const cache = new Map(); // matchId -> { stats, fetchedAt }
const inFlight = new Map(); // matchId -> promesse en cours

export async function getHeadToHead(matchId, token) {
  if (!matchId) return null;

  const cached = cache.get(matchId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.stats;
  }

  const pending = inFlight.get(matchId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const r = await fetch(`${BASE}/matches/${matchId}/head2head?limit=${LIMIT}`, {
        headers: { "X-Auth-Token": token },
      });
      if (!r.ok) return cached ? cached.stats : null;
      const data = await r.json();
      const agg = data.aggregates;
      if (!agg || !agg.numberOfMatches) return cached ? cached.stats : null;

      const stats = {
        numberOfMatches: agg.numberOfMatches,
        totalGoals: agg.totalGoals ?? 0,
        homeWins: agg.homeTeam?.wins ?? 0,
        draws: agg.homeTeam?.draws ?? 0,
        awayWins: agg.awayTeam?.wins ?? 0,
      };
      cache.set(matchId, { stats, fetchedAt: Date.now() });
      return stats;
    } catch {
      return cached ? cached.stats : null;
    } finally {
      inFlight.delete(matchId);
    }
  })();

  inFlight.set(matchId, promise);
  return promise;
}
