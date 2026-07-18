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
    const results = await Promise.all(
      COMPETITIONS.map(async (comp) => {
        const r = await fetch(
          `${BASE}/competitions/${comp.code}/matches?status=SCHEDULED,TIMED,LIVE,IN_PLAY,PAUSED,FINISHED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          { headers: { "X-Auth-Token": token } }
        );
        if (!r.ok) return { ...comp, matches: [] };
        const data = await r.json();
        return { ...comp, matches: (data.matches || []).slice(0, 40) };
      })
    );
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ competitions: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
