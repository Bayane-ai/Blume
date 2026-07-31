// Bloc 5 (multi-sport) — équivalent tennis de pages/api/matches.js et pages/api/
// basketball/matches.js : les matchs des 8 prochains jours (aujourd'hui inclus),
// toutes catégories confondues (voir PROMPT bloc 5, point 3 — aucun tournoi filtré),
// regroupés par tournoi — voir lib/sports/tennis/provider.js pour la source réelle
// (API-Tennis) et son cache (5 min par date, les matchs à venir ne changent pas
// d'heure d'une minute à l'autre).
import { getTennisApiKey, getMatchesByDate } from "../../../lib/sports/tennis/provider";
import { mapMatchToUpcoming } from "../../../lib/sports/tennis/mapper";

const NUM_DAYS = 8; // aujourd'hui + 7 jours, même fenêtre que les autres sports

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const key = getTennisApiKey();
  if (!key) {
    return res.status(500).json({ error: "Clé API tennis manquante. Les matchs à venir ne sont pas disponibles pour le moment." });
  }

  try {
    const dateStrings = Array.from({ length: NUM_DAYS }, (_, i) => isoDate(new Date(Date.now() + i * 24 * 3600000)));
    const perDate = await Promise.all(dateStrings.map((d) => getMatchesByDate(d, key)));
    const games = perDate.flat();
    console.log(`[API-Tennis] /games?date=... (${NUM_DAYS} jours) : ${games.length} match(s) reçu(s) au total`);

    // Regroupe par tournoi RÉELLEMENT présent dans les matchs reçus — jamais une
    // liste de tournois fixée à l'avance (même principe que les autres sports) :
    // TOUS les tournois renvoyés par l'API apparaissent, sans exception (ATP, WTA,
    // Grand Chelem, Masters 1000, ATP 250/500, Challengers, ITF).
    const byCode = new Map(); // code -> { name, area, surface, category, matches: [] }
    for (const raw of games) {
      const m = mapMatchToUpcoming(raw);
      if (!m.homeTeam.name || !m.awayTeam.name || !m.utcDate) continue;
      const code = m.competition.code;
      if (!code) continue;
      if (!byCode.has(code)) {
        byCode.set(code, {
          name: m.competition.name, area: m.competition.area,
          surface: m.competition.surface, category: m.competition.category,
          matches: [],
        });
      }
      byCode.get(code).matches.push({ ...m, pronostic: { available: false } });
    }

    const results = [...byCode.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([code, entry]) => ({
        code, name: entry.name, area: entry.area, surface: entry.surface, category: entry.category, matches: entry.matches,
      }));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ competitions: results });
  } catch (e) {
    console.error("Erreur /api/tennis/matches:", e.message);
    return res.status(502).json({ error: "Les matchs à venir ne sont pas disponibles pour le moment. Réessaie dans quelques minutes." });
  }
}
