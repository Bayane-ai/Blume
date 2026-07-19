import { getStandingsTable } from "../../lib/standingsCache";
import { getTeamRecentForm } from "../../lib/teamForm";
import { getLiveMatch } from "../../lib/liveMatchCache";
import { computePronostic, computeLivePronostic } from "../../lib/pronostic";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

async function resolveTeamStats(teamId, table, token) {
  const row = table?.find((r) => String(r.team.id) === String(teamId));
  if (row && row.playedGames) return { stats: row, source: "classement" };

  const recentForm = await getTeamRecentForm(teamId, token);
  if (recentForm) return { stats: recentForm, source: "forme récente" };

  return { stats: null, source: "estimation moyenne" };
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const { matchId, competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = req.query;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });
  if (!competitionCode || !homeTeamId || !awayTeamId) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }

  try {
    // Le score/la minute viennent toujours de l'API, jamais d'une valeur transmise par
    // le client. Le cache de quelques secondes ici n'est pas "figé" : il sert seulement
    // à mutualiser les appels entre plusieurs visiteurs qui suivent le même match en
    // même temps, pour pouvoir actualiser souvent sans dépasser le quota de l'API
    // (sinon les requêtes échouent et le pronostic retombe silencieusement sur
    // l'estimation pré-match au lieu de suivre le score réel).
    const liveMatch = matchId ? await getLiveMatch(matchId, token) : null;

    const table = await getStandingsTable(competitionCode, token);

    // Une équipe absente du classement (phase à élimination directe, coupe sans tableau
    // de classement, etc.) ne doit pas bloquer le pronostic : on se rabat sur ses derniers
    // matchs joués, pour que l'analyse fonctionne quel que soit le moment de la recherche.
    const [homeResolved, awayResolved] = await Promise.all([
      resolveTeamStats(homeTeamId, table, token),
      resolveTeamStats(awayTeamId, table, token),
    ]);

    const isLive = liveMatch && LIVE_STATUSES.includes(liveMatch.status);
    const result = isLive
      ? computeLivePronostic({
          homeRow: homeResolved.stats,
          awayRow: awayResolved.stats,
          homeTeamName,
          awayTeamName,
          homeSource: homeResolved.source,
          awaySource: awayResolved.source,
          currentHome: liveMatch.score?.fullTime?.home,
          currentAway: liveMatch.score?.fullTime?.away,
          minute: liveMatch.minute,
        })
      : computePronostic({
          homeRow: homeResolved.stats,
          awayRow: awayResolved.stats,
          homeTeamName,
          awayTeamName,
          homeSource: homeResolved.source,
          awaySource: awayResolved.source,
        });

    if (liveMatch) {
      result.matchStatus = liveMatch.status;
      result.matchMinute = liveMatch.minute;
      result.matchScore = liveMatch.score?.fullTime || null;
    }

    // Même raison que dans live-matches.js : sous charge, Vercel peut répartir les
    // requêtes sur plusieurs instances qui ne partagent pas leur cache mémoire
    // (liveMatchCache.js). Cet en-tête fait que le réseau Vercel mutualise réellement
    // les réponses (par match, via l'URL complète en clé de cache) entre toutes les
    // instances, ce qui borne le nombre d'appels à l'API football-data.org même si
    // plusieurs visiteurs suivent le même match en même temps sur des instances
    // différentes.
    res.setHeader("Cache-Control", "s-maxage=3, stale-while-revalidate=20");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
