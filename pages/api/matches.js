import { COMPETITIONS } from "../../lib/competitions";

const BASE = "https://api.football-data.org/v4";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
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
    const results = COMPETITIONS.map((comp) => ({ ...comp, matches: byCode.get(comp.code) || [] }));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ competitions: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
