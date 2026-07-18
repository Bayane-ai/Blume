import { COMPETITIONS } from "../../lib/competitions";

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
    const r = await fetch(
      `${BASE}/competitions/${comp.code}/matches?status=SCHEDULED,TIMED,LIVE,IN_PLAY,PAUSED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      { headers: { "X-Auth-Token": token } }
    );
    if (!r.ok) return res.status(200).json({ ...comp, matches: [] });
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({ ...comp, matches: (data.matches || []).slice(0, 100) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
