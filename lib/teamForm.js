// Repli quand une équipe n'apparaît dans aucun classement de compétition
// (ex : phase à élimination directe, coupe sans tableau, équipe pas encore classée) :
// on estime sa force d'attaque/défense à partir de ses derniers matchs réellement joués,
// toutes compétitions confondues. Ça permet d'avoir toujours un pronostic exploitable.
const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RECENT_MATCHES = 10;

const cache = new Map(); // teamId -> { stats, fetchedAt }

export async function getTeamRecentForm(teamId, token) {
  if (!teamId) return null;
  const cached = cache.get(teamId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.stats;
  }

  try {
    const r = await fetch(
      `${BASE}/teams/${teamId}/matches?status=FINISHED&limit=${RECENT_MATCHES}`,
      { headers: { "X-Auth-Token": token } }
    );
    if (!r.ok) return cached ? cached.stats : null;
    const data = await r.json();
    const matches = data.matches || [];

    let goalsFor = 0;
    let goalsAgainst = 0;
    let counted = 0;
    for (const m of matches) {
      const isHome = String(m.homeTeam?.id) === String(teamId);
      const gf = isHome ? m.score?.fullTime?.home : m.score?.fullTime?.away;
      const ga = isHome ? m.score?.fullTime?.away : m.score?.fullTime?.home;
      if (gf === null || gf === undefined || ga === null || ga === undefined) continue;
      goalsFor += gf;
      goalsAgainst += ga;
      counted += 1;
    }
    if (counted === 0) return cached ? cached.stats : null;

    const stats = { playedGames: counted, goalsFor, goalsAgainst, position: null, points: null, form: null };
    cache.set(teamId, { stats, fetchedAt: Date.now() });
    return stats;
  } catch {
    return cached ? cached.stats : null;
  }
}
