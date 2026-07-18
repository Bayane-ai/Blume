import { getStandingsTable } from "../../lib/standingsCache";
import { getTeamRecentForm } from "../../lib/teamForm";
import { computePronostic, computeLivePronostic } from "../../lib/pronostic";

const BASE = "https://api.football-data.org/v4";
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
    // Le score/la minute affichés doivent toujours venir de l'API en temps réel : on
    // relit systématiquement l'état du match ici (jamais de cache), plutôt que de faire
    // confiance à un score potentiellement périmé transmis par le client.
    let liveMatch = null;
    if (matchId) {
      const mr = await fetch(`${BASE}/matches/${matchId}`, { headers: { "X-Auth-Token": token } });
      if (mr.ok) {
        const mdata = await mr.json();
        liveMatch = mdata?.match || mdata;
      }
    }

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

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
