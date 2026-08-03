// Bloc 1 (multi-sport) — équivalent basket de pages/api/matches.js : les matchs des 8
// prochains jours (aujourd'hui inclus), toutes compétitions confondues, regroupés par
// compétition — voir lib/sports/basketball/provider.js pour la source réelle
// (API-SPORTS Basketball) et son cache (5 min par date, les matchs à venir ne
// changent pas d'heure d'une minute à l'autre).
import { getBasketballApiKey, getGamesByDate } from "../../../lib/sports/basketball/provider";
import { mapGameToUpcoming } from "../../../lib/sports/basketball/mapper";
import { isQuotaExhausted } from "../../../lib/apiQuota";
import { readPersistentCache } from "../../../lib/apiSportsCache";

const NUM_DAYS = 8; // aujourd'hui + 7 jours, même fenêtre que pages/api/matches.js

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const key = getBasketballApiKey();
  if (!key) {
    return res.status(500).json({ error: "Clé API basket manquante. Les matchs à venir ne sont pas disponibles pour le moment." });
  }

  try {
    const dateStrings = Array.from({ length: NUM_DAYS }, (_, i) => isoDate(new Date(Date.now() + i * 24 * 3600000)));
    const perDate = await Promise.all(dateStrings.map((d) => getGamesByDate(d, key)));
    const games = perDate.flat();
    console.log(`[API-Basketball] /games?date=... (${NUM_DAYS} jours) : ${games.length} match(s) reçu(s) au total`);

    // Regroupe par compétition RÉELLEMENT présente dans les matchs reçus — jamais une
    // liste de compétitions fixée à l'avance (même principe que pages/api/matches.js) :
    // TOUTES les compétitions renvoyées par l'API apparaissent, sans exception.
    const byCode = new Map(); // code -> { name, area, matches: [] }
    for (const raw of games) {
      const m = mapGameToUpcoming(raw);
      if (!m.homeTeam.name || !m.awayTeam.name || !m.utcDate) continue;
      const code = m.competition.code;
      if (!code) continue;
      if (!byCode.has(code)) {
        byCode.set(code, { name: m.competition.name, area: m.competition.area, matches: [] });
      }
      byCode.get(code).matches.push({ ...m, pronostic: { available: false } });
    }

    const results = [...byCode.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([code, entry]) => ({ code, name: entry.name, area: entry.area, matches: entry.matches }));

    // Même principe que pages/api/basketball/live-matches.js : quota du jour confirmé
    // épuisé -> indicateur discret de fraîcheur plutôt qu'une erreur, la réponse
    // pouvant déjà venir intégralement du cache persisté (voir provider.js).
    let stale = false;
    let lastUpdated = null;
    if (await isQuotaExhausted("basketball")) {
      const todayStr = dateStrings[0];
      const cached = await readPersistentCache(`basketball:upcoming:${todayStr}`);
      if (cached) {
        stale = true;
        lastUpdated = new Date(cached.fetchedAt).toISOString();
      }
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ competitions: results, ...(stale ? { stale, lastUpdated } : {}) });
  } catch (e) {
    console.error("Erreur /api/basketball/matches:", e.message);
    return res.status(502).json({ error: "Les matchs à venir ne sont pas disponibles pour le moment. Réessaie dans quelques minutes." });
  }
}
