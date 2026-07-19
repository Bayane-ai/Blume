import { COMPETITIONS } from "../../lib/competitions";
import { getStandingsTable } from "../../lib/standingsCache";
import { computePronostic } from "../../lib/pronostic";

const BASE = "https://api.football-data.org/v4";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// view=upcoming (défaut) : calendrier des prochains matchs (90 jours à venir).
// view=results : matchs déjà joués (90 derniers jours), triés du plus récent au
// plus ancien — pour l'onglet "Résultats" de la page d'une compétition.
export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  const { code, view } = req.query;
  const comp = COMPETITIONS.find((c) => c.code === code);
  if (!comp) return res.status(400).json({ error: "Compétition inconnue" });

  const isResults = view === "results";
  const dateFrom = isResults ? isoDate(new Date(Date.now() - 90 * 24 * 3600000)) : isoDate(new Date());
  const dateTo = isResults ? isoDate(new Date()) : isoDate(new Date(Date.now() + 90 * 24 * 3600000));
  const status = isResults ? "FINISHED" : "SCHEDULED,TIMED,LIVE,IN_PLAY,PAUSED";

  try {
    const [r, table] = await Promise.all([
      fetch(
        `${BASE}/competitions/${comp.code}/matches?status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=100`,
        { headers: { "X-Auth-Token": token } }
      ),
      getStandingsTable(comp.code, token),
    ]);
    if (!r.ok) return res.status(r.status).json({ ...comp, error: `Erreur API football-data (code ${r.status})`, matches: [] });
    const data = await r.json();

    let matches = (data.matches || []).slice(0, 100).map((m) => {
      const homeRow = table?.find((row) => String(row.team.id) === String(m.homeTeam?.id));
      const awayRow = table?.find((row) => String(row.team.id) === String(m.awayTeam?.id));
      const pronostic = computePronostic({
        homeRow, awayRow, homeTeamName: m.homeTeam?.name, awayTeamName: m.awayTeam?.name,
      });
      return { ...m, pronostic };
    });

    if (isResults) {
      matches = [...matches].sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
    }

    res.setHeader("Cache-Control", `s-maxage=${isResults ? 300 : 120}, stale-while-revalidate=${isResults ? 900 : 300}`);
    return res.status(200).json({ ...comp, matches });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
