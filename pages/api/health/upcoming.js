import { getSession } from "../../../lib/session";
import { isAdmin } from "../../../lib/auth/admin";
import { getBasketballApiKey, getGamesByDate } from "../../../lib/sports/basketball/provider";
import { matchesUrl } from "../../../lib/sportScore";

// Diagnostic "matchs à venir" — produit le tableau SPORT × JOUR (J à J+7) réclamé
// quand une section reste vide alors que des matchs existent réellement.
//
// Réservé à l'administrateur (même garde que /admin) : chaque appel déclenche de vrais
// appels réseau, qui ne doivent jamais être déclenchables par un visiteur.
//
// Il n'existe PAS d'équivalent exécutable depuis l'environnement de développement :
// son pare-feu bloque tout hôte externe (vérifié : même example.com est refusé). Cette
// route est donc le seul moyen d'obtenir les vrais nombres, depuis la production.
const HORIZON_DAYS = 7;

// Jour calendaire en Europe/Paris (le fuseau de référence demandé), et non en UTC :
// un match de 23h30 doit compter pour le bon jour côté visiteur.
function parisDayKey(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function dayKeys() {
  return Array.from({ length: HORIZON_DAYS + 1 }, (_, i) => parisDayKey(new Date(Date.now() + i * 24 * 3600000)));
}

async function sportScoreByDay(sport) {
  const out = { total: 0, httpStatus: null, error: null, byDay: {}, samples: [] };
  try {
    const res = await fetch(matchesUrl(sport), { headers: { Accept: "application/json" } });
    out.httpStatus = res.status;
    if (!res.ok) {
      out.error = (await res.text().catch(() => "")).slice(0, 200);
      return out;
    }
    const payload = await res.json();
    const list = Array.isArray(payload) ? payload : payload?.matches || payload?.data || payload?.results || [];
    out.total = list.length;
    for (const raw of list) {
      const iso = raw?.start_at || raw?.start_time || raw?.scheduled_at || raw?.date;
      if (!iso) continue;
      const key = parisDayKey(new Date(iso));
      out.byDay[key] = (out.byDay[key] || 0) + 1;
    }
    out.samples = list.slice(0, 3).map((raw) => ({
      home: raw?.home_team?.name || raw?.home?.name || null,
      away: raw?.away_team?.name || raw?.away?.name || null,
      competition: raw?.league?.name || raw?.tournament?.name || null,
      start: raw?.start_at || raw?.start_time || null,
      status: typeof raw?.status === "string" ? raw.status : raw?.status?.type || null,
    }));
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

async function basketballByDay(key) {
  const out = { total: 0, error: null, byDay: {}, samples: [], keyPresent: Boolean(key) };
  if (!key) {
    out.error = "Clé absente (API_BASKETBALL_KEY ou API_FOOTBALL_KEY)";
    return out;
  }
  for (const day of dayKeys()) {
    try {
      const games = await getGamesByDate(day, key);
      out.byDay[day] = games.length;
      out.total += games.length;
      if (out.samples.length < 3 && games.length > 0) {
        out.samples.push(
          ...games.slice(0, 3 - out.samples.length).map((g) => ({
            home: g?.teams?.home?.name || null,
            away: g?.teams?.away?.name || null,
            competition: g?.league?.name || null,
            start: g?.date || null,
            status: g?.status?.short || null,
          }))
        );
      }
    } catch (e) {
      out.byDay[day] = null;
      out.error = out.error || e.message;
    }
  }
  return out;
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session || !isAdmin(session.email)) {
    res.statusCode = 403;
    return res.end("Non autorisé");
  }

  const [ssFootball, ssBasket, ssTennis, basket] = await Promise.all([
    sportScoreByDay("football"),
    sportScoreByDay("basketball"),
    sportScoreByDay("tennis"),
    basketballByDay(getBasketballApiKey()),
  ]);

  return res.status(200).json({
    checkedAt: new Date().toISOString(),
    timezone: "Europe/Paris",
    days: dayKeys(),
    football: { sportScore: ssFootball },
    basketball: { sportScore: ssBasket, apiBasketball: basket },
    // Le tennis n'a plus qu'une source pour les matchs à venir : le plan gratuit de
    // Live Tennis API n'expose pas de calendrier (elle ne sert plus que pour le direct).
    tennis: { sportScore: ssTennis },
  });
}
