import { COMPETITIONS } from "../../lib/competitions";
import { getStandingsTable } from "../../lib/standingsCache";
import { computePronostic } from "../../lib/pronostic";

const BASE = "https://api.football-data.org/v4";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function attachPronostic(m, table) {
  const homeRow = table?.find((row) => String(row.team.id) === String(m.homeTeam?.id));
  const awayRow = table?.find((row) => String(row.team.id) === String(m.awayTeam?.id));
  // computePronostic se rabat sur une estimation moyenne si une équipe est absente du
  // classement (phase à élimination directe, etc.) : le pronostic est toujours disponible.
  const pronostic = computePronostic({
    homeRow, awayRow, homeTeamName: m.homeTeam?.name, awayTeamName: m.awayTeam?.name,
  });
  return { ...m, pronostic };
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  const dateFrom = isoDate(new Date());
  const dateTo = isoDate(new Date(Date.now() + 7 * 24 * 3600000));

  try {
    // Un seul appel global (toutes compétitions confondues) au lieu d'un appel par
    // compétition : le plan gratuit football-data.org limite à 10 requêtes/minute,
    // et 12 appels en parallèle (+ le rafraîchissement automatique) dépassait ce quota,
    // ce qui faisait disparaître silencieusement tous les matchs.
    const r = await fetch(
      `${BASE}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED,TIMED,LIVE,IN_PLAY,PAUSED,FINISHED&limit=100`,
      { headers: { "X-Auth-Token": token } }
    );
    if (!r.ok) {
      return res.status(r.status).json({ error: `Erreur API football-data (code ${r.status})` });
    }
    const data = await r.json();

    const byCode = new Map();
    for (const m of data.matches || []) {
      const code = m.competition?.code;
      if (!code) continue;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(m);
    }

    // Un classement par compétition (mis en cache) plutôt qu'un calcul par match : les
    // pronostics sont prêts pour tous les matchs affichés, sans attendre de clic.
    const codesWithMatches = [...byCode.keys()];
    const standingsByCode = {};
    await Promise.all(
      codesWithMatches.map(async (code) => {
        standingsByCode[code] = await getStandingsTable(code, token);
      })
    );

    const results = COMPETITIONS.map((comp) => {
      const matches = (byCode.get(comp.code) || []).map((m) => attachPronostic(m, standingsByCode[comp.code]));
      return { ...comp, matches };
    });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ competitions: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
