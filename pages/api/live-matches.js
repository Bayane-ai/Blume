import { getStandingsTable } from "../../lib/standingsCache";
import { computePronostic } from "../../lib/pronostic";

const BASE = "https://api.football-data.org/v4";
const MAX_MATCHES = 20;

function attachPronostic(m, table) {
  const homeRow = table?.find((row) => String(row.team.id) === String(m.homeTeam?.id));
  const awayRow = table?.find((row) => String(row.team.id) === String(m.awayTeam?.id));
  const pronostic = computePronostic({
    homeRow, awayRow, homeTeamName: m.homeTeam?.name, awayTeamName: m.awayTeam?.name,
  });
  return { ...m, pronostic };
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  try {
    // Tous les matchs en direct (IN_PLAY + PAUSED via le pseudo-statut LIVE de
    // football-data.org), sans filtrer par compétition ni par pays : on prend tel quel
    // ce que l'API renvoie réellement, jamais de matchs inventés pour compléter.
    const r = await fetch(`${BASE}/matches?status=LIVE`, {
      headers: { "X-Auth-Token": token },
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `Erreur API football-data (code ${r.status})` });
    }
    const data = await r.json();
    const liveMatches = (data.matches || []).slice(0, MAX_MATCHES);

    const codes = [...new Set(liveMatches.map((m) => m.competition?.code).filter(Boolean))];
    const standingsByCode = {};
    await Promise.all(
      codes.map(async (code) => {
        standingsByCode[code] = await getStandingsTable(code, token);
      })
    );

    const matches = liveMatches.map((m) => attachPronostic(m, standingsByCode[m.competition?.code]));

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    return res.status(200).json({ matches });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
