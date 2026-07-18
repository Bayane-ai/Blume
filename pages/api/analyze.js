import { getStandingsTable } from "../../lib/standingsCache";
import { computePronostic } from "../../lib/pronostic";

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const { competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = req.query;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });
  if (!competitionCode || !homeTeamId || !awayTeamId) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }

  try {
    const table = await getStandingsTable(competitionCode, token);
    if (!table) {
      return res.status(200).json({
        available: false,
        message: "Classement indisponible pour cette compétition (ex : Coupe du Monde).",
      });
    }
    const homeRow = table.find((row) => String(row.team.id) === String(homeTeamId));
    const awayRow = table.find((row) => String(row.team.id) === String(awayTeamId));
    const result = computePronostic({ homeRow, awayRow, homeTeamName, awayTeamName });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
