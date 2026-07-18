import { COMPETITIONS } from "../../lib/competitions";
import { getStandingsTable } from "../../lib/standingsCache";
import { computePronostic } from "../../lib/pronostic";

const BASE = "https://api.football-data.org/v4";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  const { code } = req.query;
  const comp = COMPETITIONS.find((c) => c.code === code);
  if (!comp) return res.status(400).json({ error: "Compétition inconnue" });

  const dateFrom = isoDate(new Date());
  const dateTo = isoDate(new Date(Date.now() + 90 * 24 * 3600000));

  try {
    const [r, table] = await Promise.all([
      fetch(
        `${BASE}/competitions/${comp.code}/matches?status=SCHEDULED,TIMED,LIVE,IN_PLAY,PAUSED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        { headers: { "X-Auth-Token": token } }
      ),
      getStandingsTable(comp.code, token),
    ]);
    if (!r.ok) return res.status(r.status).json({ ...comp, error: `Erreur API football-data (code ${r.status})`, matches: [] });
    const data = await r.json();

    const matches = (data.matches || []).slice(0, 100).map((m) => {
      const homeRow = table?.find((row) => String(row.team.id) === String(m.homeTeam?.id));
      const awayRow = table?.find((row) => String(row.team.id) === String(m.awayTeam?.id));
      const pronostic = computePronostic({
        homeRow, awayRow, homeTeamName: m.homeTeam?.name, awayTeamName: m.awayTeam?.name,
      });
      return { ...m, pronostic };
    });

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({ ...comp, matches });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
