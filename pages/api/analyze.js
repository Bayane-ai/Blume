const BASE = "https://api.football-data.org/v4";

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const { competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = req.query;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });
  if (!competitionCode || !homeTeamId || !awayTeamId) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }

  try {
    const r = await fetch(`${BASE}/competitions/${competitionCode}/standings`, {
      headers: { "X-Auth-Token": token },
    });
    if (!r.ok) throw new Error("Classement indisponible");
    const data = await r.json();
    const table = data.standings?.[0]?.table || [];

    const findTeam = (id) => table.find((row) => String(row.team.id) === String(id));
    const home = findTeam(homeTeamId);
    const away = findTeam(awayTeamId);

    if (!home || !away) {
      return res.status(200).json({
        available: false,
        message: "Classement indisponible pour cette compétition (ex : Coupe du Monde).",
      });
    }

    const totalTeams = table.length || 20;
    const homeStrength = (totalTeams - home.position + 1) + 3; // +3 = avantage terrain
    const awayStrength = (totalTeams - away.position + 1);
    const total = homeStrength + awayStrength;

    const homeWinPct = Math.round((homeStrength / total) * 70) + 15;
    const awayWinPct = Math.round((awayStrength / total) * 70) + 10;
    const drawPct = Math.max(5, 100 - homeWinPct - awayWinPct);

    return res.status(200).json({
      available: true,
      home: { name: homeTeamName, position: home.position, points: home.points, form: home.form },
      away: { name: awayTeamName, position: away.position, points: away.points, form: away.form },
      probabilities: { home: homeWinPct, draw: drawPct, away: awayWinPct },
      note: "Estimation basée sur le classement actuel et l'avantage du terrain (pas une IA).",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
