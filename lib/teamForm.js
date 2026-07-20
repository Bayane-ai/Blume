// Performance réelle et récente d'un club : ses derniers matchs réellement joués,
// toutes compétitions confondues — la base de calcul des pronostics (voir
// pages/api/analyze.js), plutôt qu'une moyenne de saison qui gomme les différences
// entre deux équipes proches au classement. Sert aussi de repli quand une équipe
// n'apparaît dans aucun classement (ex : phase à élimination directe).
const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RECENT_MATCHES = 10;
const FORM_LENGTH = 5; // "WWDLW" : 5 derniers résultats, comme le format football-data.org

const cache = new Map(); // teamId -> { stats, fetchedAt }
const inFlight = new Map(); // teamId -> promesse en cours

function resultLetter(gf, ga) {
  if (gf > ga) return "W";
  if (gf < ga) return "L";
  return "D";
}

export async function getTeamRecentForm(teamId, token) {
  if (!teamId) return null;

  const cached = cache.get(teamId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.stats;
  }

  const pending = inFlight.get(teamId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const r = await fetch(
        `${BASE}/teams/${teamId}/matches?status=FINISHED&limit=${RECENT_MATCHES}`,
        { headers: { "X-Auth-Token": token } }
      );
      if (!r.ok) return cached ? cached.stats : null;
      const data = await r.json();
      // Du plus ancien au plus récent : la lettre la plus à droite de `form` doit
      // être le dernier match joué, comme le format football-data.org.
      const matches = [...(data.matches || [])].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

      let goalsFor = 0;
      let goalsAgainst = 0;
      let counted = 0;
      // Répartition domicile/extérieur des mêmes matchs déjà récupérés (aucun appel
      // API supplémentaire) : une équipe qui marque beaucoup à domicile mais peu à
      // l'extérieur (ou l'inverse) a un profil différent selon où CE match précis se
      // joue — voir lib/pronostic.js, qui privilégie ces moyennes réelles par lieu
      // plutôt qu'un facteur d'avantage du terrain générique, quand l'échantillon est
      // assez grand.
      let homeGoalsFor = 0, homeGoalsAgainst = 0, homePlayedGames = 0;
      let awayGoalsFor = 0, awayGoalsAgainst = 0, awayPlayedGames = 0;
      const letters = [];
      for (const m of matches) {
        const isHome = String(m.homeTeam?.id) === String(teamId);
        const gf = isHome ? m.score?.fullTime?.home : m.score?.fullTime?.away;
        const ga = isHome ? m.score?.fullTime?.away : m.score?.fullTime?.home;
        if (gf === null || gf === undefined || ga === null || ga === undefined) continue;
        goalsFor += gf;
        goalsAgainst += ga;
        counted += 1;
        letters.push(resultLetter(gf, ga));
        if (isHome) {
          homeGoalsFor += gf; homeGoalsAgainst += ga; homePlayedGames += 1;
        } else {
          awayGoalsFor += gf; awayGoalsAgainst += ga; awayPlayedGames += 1;
        }
      }
      if (counted === 0) return cached ? cached.stats : null;

      const stats = {
        playedGames: counted, goalsFor, goalsAgainst, position: null, points: null,
        form: letters.slice(-FORM_LENGTH).join("") || null,
        homeGoalsFor, homeGoalsAgainst, homePlayedGames,
        awayGoalsFor, awayGoalsAgainst, awayPlayedGames,
      };
      cache.set(teamId, { stats, fetchedAt: Date.now() });
      return stats;
    } catch {
      return cached ? cached.stats : null;
    } finally {
      inFlight.delete(teamId);
    }
  })();

  inFlight.set(teamId, promise);
  return promise;
}
