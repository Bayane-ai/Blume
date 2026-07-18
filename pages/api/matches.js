const BASE = "https://api.football-data.org/v4";

const COMPETITIONS = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "LaLiga" },
  { code: "SA", name: "Serie A" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "CL", name: "Ligue des Champions" },
  { code: "WC", name: "Coupe du Monde" },
];

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  try {
    const results = await Promise.all(
      COMPETITIONS.map(async (comp) => {
        const r = await fetch(`${BASE}/competitions/${comp.code}/matches?status=SCHEDULED,LIVE,IN_PLAY,PAUSED,FINISHED`, {
          headers: { "X-Auth-Token": token },
        });
        if (!r.ok) return { ...comp, matches: [] };
        const data = await r.json();
        return { ...comp, matches: (data.matches || []).slice(0, 15) };
      })
    );
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ competitions: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
                           }
