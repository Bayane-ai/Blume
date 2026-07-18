import { getStandingsTable } from "../../lib/standingsCache";
import { computePronostic } from "../../lib/pronostic";

const BASE = "https://api.football-data.org/v4";

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
    // football-data.org), sans filtrer par compétition ni par pays, et sans plafond
    // artificiel : on affiche exactement ce que l'API renvoie, jamais plus, jamais moins.
    // &limit=100 dépasse largement le nombre de matchs simultanément en direct possibles
    // sur les compétitions couvertes par le token, pour ne jamais en tronquer.
    const r = await fetch(`${BASE}/matches?status=LIVE&limit=100`, {
      headers: { "X-Auth-Token": token },
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `Erreur API football-data (code ${r.status})` });
    }
    const data = await r.json();
    const liveMatches = data.matches || [];

    const codes = [...new Set(liveMatches.map((m) => m.competition?.code).filter(Boolean))];
    const standingsByCode = {};
    await Promise.all(
      codes.map(async (code) => {
        standingsByCode[code] = await getStandingsTable(code, token);
      })
    );

    const matches = liveMatches.map((m) => attachPronostic(m, standingsByCode[m.competition?.code]));

    // Pas de cache figé : quelques secondes tout au plus, juste pour absorber des
    // requêtes quasi simultanées, jamais pour servir une liste de matchs périmée.
    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=10");
    return res.status(200).json({ matches });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
