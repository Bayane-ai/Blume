// Bloc 1 (multi-sport) — équivalent basket de pages/api/live-matches.js : TOUS les
// matchs actuellement en direct dans le monde, toutes compétitions confondues (NBA,
// EuroLeague, WNBA, NCAA, championnats nationaux...), sans le moindre filtre — voir
// lib/sports/basketball/provider.js (API-SPORTS Basketball, cache court côté serveur)
// et lib/sports/basketball/mapper.js (mise en forme, même structure que le football
// pour que components/MatchCard.js reste inchangé, voir bloc 2).
//
// Pas encore de pronostic (bloc 3) : chaque match reçoit honnêtement
// `pronostic: { available: false }`, jamais une estimation inventée.
import { getBasketballApiKey, getLiveGames } from "../../../lib/sports/basketball/provider";
import { mapGameToLiveMatch } from "../../../lib/sports/basketball/mapper";

export default async function handler(req, res) {
  const key = getBasketballApiKey();
  // Message clair en français, jamais un texte technique ("contactez l'administrateur")
  // — voir PROMPT bloc 1, point 5.
  if (!key) {
    return res.status(500).json({ error: "Clé API basket manquante. Le direct basket n'est pas disponible pour le moment." });
  }

  try {
    const games = await getLiveGames(key);
    const matches = games
      .map(mapGameToLiveMatch)
      .filter((m) => m.homeTeam.name && m.awayTeam.name)
      .map((m) => ({ ...m, pronostic: { available: false } }));

    // Même mécanisme que pages/api/live-matches.js : le CDN Vercel mutualise les
    // réponses entre toutes les instances/visiteurs pendant quelques secondes, pour
    // que l'actualisation fréquente côté client (15-30s) ne multiplie pas les appels
    // réels vers API-Basketball (déjà protégés par le cache serveur de 45s, voir
    // provider.js).
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json({ matches });
  } catch (e) {
    console.error("Erreur /api/basketball/live-matches:", e.message);
    return res.status(502).json({ error: "Le direct basket n'est pas disponible pour le moment. Réessaie dans quelques minutes." });
  }
}
