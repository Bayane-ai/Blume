import { matchesUrl, mapSportScoreMatch } from "../../../lib/sportScore";

// Matchs de tennis À VENIR.
//
// Cette route répondait auparavant par un refus ÉCRIT EN DUR ("non disponibles avec
// cette source, plan gratuit"), parce que le plan gratuit de Live Tennis API n'expose
// pas de calendrier. C'était une décision du code : elle masquait des matchs pourtant
// disponibles ailleurs, et un écran vide ne doit JAMAIS venir d'une décision du code.
//
// Elle interroge désormais réellement SportScore (API publique, sans clé) côté serveur.
// Live Tennis API ne sert plus que pour le direct (voir ./live-matches.js).
//
// Un résultat vide n'est donc plus qu'un fait constaté : la source a répondu, et elle
// n'avait rien. Les informations de diagnostic (source, code HTTP, plage de dates)
// accompagnent la réponse pour que l'interface puisse les afficher sans rien deviner.
const HORIZON_DAYS = 7;

function parisDayKey(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export default async function handler(req, res) {
  const from = parisDayKey(new Date());
  const to = parisDayKey(new Date(Date.now() + HORIZON_DAYS * 24 * 3600000));
  const source = "SportScore";
  const url = matchesUrl("tennis");

  let httpStatus = null;
  try {
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    httpStatus = upstream.status;
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      console.warn(`[tennis/matches] ${source} a répondu ${httpStatus} — ${body.slice(0, 200)}`);
      return res.status(200).json({
        competitions: [],
        diagnostic: { source, httpStatus, from, to, error: `HTTP ${httpStatus}` },
      });
    }

    const payload = await upstream.json();
    const list = Array.isArray(payload)
      ? payload
      : payload?.matches || payload?.data || payload?.results || payload?.items || [];

    const now = Date.now();
    const limit = now + HORIZON_DAYS * 24 * 3600 * 1000;
    // Aucun filtre de tournoi, de catégorie ni de circuit : seuls comptent "pas encore
    // commencé" et la fenêtre de dates demandée.
    // Mapper SPORTSCORE (et non celui de Live Tennis API : les deux sources n'ont pas
    // la même forme de réponse), puis conversion vers la forme interne du site.
    const matches = list
      .map((raw, i) => mapSportScoreMatch(raw, "tennis", i))
      .filter((m) => {
        if (!m.home.name || !m.away.name || !m.startTime) return false;
        if (m.status !== "upcoming") return false;
        const t = new Date(m.startTime).getTime();
        return Number.isFinite(t) && t > now && t <= limit;
      })
      .map((m) => ({
        id: m.id,
        status: "SCHEDULED",
        utcDate: m.startTime,
        competition: { code: m.competition || "tennis", name: m.competition || "Tournoi non communiqué" },
        homeTeam: { id: "", name: m.home.name, crest: m.home.logo || "" },
        awayTeam: { id: "", name: m.away.name, crest: m.away.logo || "" },
        score: { fullTime: { home: null, away: null } },
      }));

    console.log(`[tennis/matches] ${source} : ${list.length} reçu(s), ${matches.length} à venir sur ${from} → ${to}`);

    // Groupé par tournoi, même forme que les autres routes "à venir" du site.
    const byComp = new Map();
    for (const m of matches) {
      const name = m.competition?.name || "Tournoi non communiqué";
      if (!byComp.has(name)) byComp.set(name, { code: m.competition?.code || name, name, area: "", matches: [] });
      byComp.get(name).matches.push(m);
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      competitions: [...byComp.values()],
      diagnostic: { source, httpStatus, from, to, received: list.length, upcoming: matches.length },
    });
  } catch (e) {
    console.warn(`[tennis/matches] ${source} injoignable : ${e.message}`);
    return res.status(200).json({
      competitions: [],
      diagnostic: { source, httpStatus, from, to, error: e.message },
    });
  }
}
