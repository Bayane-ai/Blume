import { getSession } from "../../../lib/session";
import { isAdmin } from "../../../lib/auth/admin";
import { loadUpcoming, localDayKey, HORIZON_DAYS } from "../../../lib/upcomingMatches";

// Endpoint de contrôle "matchs à venir" — ouvrable directement dans le navigateur
// (connecté avec le compte administrateur). Renvoie, POUR CHAQUE SPORT :
//   - le nombre de matchs trouvés JOUR PAR JOUR (J à J+7) ;
//   - la source réellement utilisée, son code HTTP et ce qu'elle a renvoyé ;
//   - la plage de dates testée.
//
// Il emprunte EXACTEMENT le même chemin que la page /a-venir (loadUpcoming) : ce qu'il
// affiche est donc ce que la page affiche, jamais une mesure parallèle qui pourrait
// diverger.
//
// Réservé à l'administrateur, comme /api/health/sports : chaque appel déclenche de
// vrais appels réseau, qui ne doivent jamais être déclenchables par un visiteur.
const SPORTS = ["football", "basketball", "tennis"];

// Les appels partent du serveur : `fetch` d'une route relative n'y existe pas, il faut
// une URL absolue construite depuis la requête entrante.
function absoluteFetch(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;
  return (url, init) => fetch(url.startsWith("/") ? `${origin}${url}` : url, init);
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session || !isAdmin(session.email)) {
    res.statusCode = 403;
    return res.end("Non autorisé");
  }

  const fetchImpl = absoluteFetch(req);
  const now = Date.now();
  const report = {};

  for (const sport of SPORTS) {
    try {
      const { days, coverage, errors, diagnostic, allSourcesFailed } = await loadUpcoming(sport, { fetchImpl, now });

      // Comptage jour par jour, sur la plage complète — un jour sans match apparaît
      // explicitement à 0, jamais omis (c'est justement l'information utile).
      const byDay = {};
      for (let i = 0; i <= HORIZON_DAYS; i += 1) {
        byDay[localDayKey(new Date(now + i * 24 * 3600 * 1000).toISOString())] = 0;
      }
      for (const day of days) {
        byDay[day.key] = day.competitions.reduce((n, c) => n + c.matches.length, 0);
      }

      report[sport] = {
        total: coverage.upcoming,
        competitions: coverage.competitions,
        byDay,
        sources: diagnostic?.sources || [],
        window: diagnostic?.window || null,
        errors,
        allSourcesFailed,
        // Rend immédiatement lisible le cas "tout a répondu 200 mais 0 match" — le seul
        // vide légitime — face à "une source est en panne".
        verdict: allSourcesFailed
          ? "ÉCHEC : aucune source n'a répondu"
          : coverage.upcoming > 0
          ? "OK"
          : "VIDE CONSTATÉ : les sources ont répondu, sans match sur la plage",
      };
    } catch (e) {
      report[sport] = { total: 0, error: e.message, verdict: "ERREUR INATTENDUE" };
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    checkedAt: new Date().toISOString(),
    horizonDays: HORIZON_DAYS,
    sports: report,
  });
}
