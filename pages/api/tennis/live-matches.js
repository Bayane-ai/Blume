// Bloc 5 (multi-sport) — équivalent tennis de pages/api/live-matches.js et pages/api/
// basketball/live-matches.js : TOUS les matchs actuellement en direct dans le monde,
// toutes catégories confondues (ATP, WTA, Grand Chelem, Masters 1000, ATP 250/500,
// Challengers, ITF — voir PROMPT bloc 5, point 3), sans le moindre filtre — voir
// lib/sports/tennis/provider.js (API-Tennis, cache court côté serveur) et lib/sports/
// tennis/mapper.js (mise en forme, même structure que le football/basket pour que
// components/MatchCard.js reste inchangé).
//
// Pas encore de pronostic (bloc 7) : chaque match reçoit honnêtement
// `pronostic: { available: false }`, jamais une estimation inventée.
import { getTennisApiKey, getLiveMatches } from "../../../lib/sports/tennis/provider";
import { mapMatchToLiveState } from "../../../lib/sports/tennis/mapper";

export default async function handler(req, res) {
  const key = getTennisApiKey();
  // Message clair en français, jamais un texte technique ("contactez l'administrateur")
  // — voir PROMPT bloc 5, point 5.
  if (!key) {
    return res.status(500).json({ error: "Clé API tennis manquante. Le direct tennis n'est pas disponible pour le moment." });
  }

  try {
    const games = await getLiveMatches(key);
    const matches = games
      .map(mapMatchToLiveState)
      .filter((m) => m.homeTeam.name && m.awayTeam.name)
      .map((m) => ({ ...m, pronostic: { available: false } }));

    // Même mécanisme que les autres sports : le CDN Vercel mutualise les réponses
    // entre toutes les instances/visiteurs pendant quelques secondes, pour que
    // l'actualisation fréquente côté client (15-30s, voir PROMPT bloc 5, point 4) ne
    // multiplie pas les appels réels vers API-Tennis (déjà protégés par le cache
    // serveur de 20s, voir provider.js).
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json({ matches });
  } catch (e) {
    console.error("Erreur /api/tennis/live-matches:", e.message);
    return res.status(502).json({ error: "Le direct tennis n'est pas disponible pour le moment. Réessaie dans quelques minutes." });
  }
}
