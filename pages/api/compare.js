import { getStandingsTable } from "../../lib/standingsCache";
import { getTeamRecentForm } from "../../lib/teamForm";
import { computePronostic } from "../../lib/pronostic";

// Moteur de la page "Analyse IA" (pages/analyse.js) : calcule un pronostic entre
// deux équipes choisies librement (pas forcément un match réellement programmé),
// à partir de leurs vraies statistiques (classement, ou à défaut forme récente
// réelle) — même moteur que /api/analyze, sans dépendre d'un match précis.
async function resolveTeamStats(teamId, table, token) {
  const row = table?.find((r) => String(r.team.id) === String(teamId));
  if (row && row.playedGames) return { stats: row, source: "classement" };

  const recentForm = await getTeamRecentForm(teamId, token);
  if (recentForm) return { stats: recentForm, source: "forme récente" };

  return { stats: null, source: "estimation moyenne" };
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const { competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = req.query;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });
  if (!competitionCode || !homeTeamId || !awayTeamId) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }
  if (homeTeamId === awayTeamId) {
    return res.status(400).json({ error: "Choisis deux équipes différentes." });
  }

  try {
    const table = await getStandingsTable(competitionCode, token);
    const [homeResolved, awayResolved] = await Promise.all([
      resolveTeamStats(homeTeamId, table, token),
      resolveTeamStats(awayTeamId, table, token),
    ]);

    const result = computePronostic({
      homeRow: homeResolved.stats,
      awayRow: awayResolved.stats,
      homeTeamName,
      awayTeamName,
      homeSource: homeResolved.source,
      awaySource: awayResolved.source,
    });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
