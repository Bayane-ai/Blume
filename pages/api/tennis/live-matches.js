// Équivalent tennis de pages/api/live-matches.js (football) — TOUS les matchs
// actuellement en direct (Live Tennis API, voir lib/sports/tennis/provider.js), sans
// filtre de tournoi. Un seul appel réel partagé par tous les visiteurs (cache
// persistant 60s, voir provider.js#getLiveMatches) — jamais un appel par visiteur.
//
// Le score détaillé (sets/jeu en cours/serveur) vient de GET /matches/{id}/score, un
// endpoint SÉPARÉ de la liste (voir PROMPT) : appeler ce détail pour CHAQUE match
// affiché à CHAQUE rafraîchissement de cette liste dépasserait vite le quota strict
// (30/min, 1000/jour, voir provider.js) dès que plusieurs matchs sont en direct en
// même temps — non appelé ici (le mapper retombe sur ce que la liste fournit déjà
// elle-même, voir mapLiveTennisMatch). Le détail précis est réservé à la page d'un
// match ouvert (voir pages/api/tennis/analyze.js).
import { getTennisApiKey, getLiveMatches } from "../../../lib/sports/tennis/provider";
import { mapMatchToLiveState } from "../../../lib/sports/tennis/mapper";

export default async function handler(req, res) {
  const key = getTennisApiKey();
  if (!key) {
    return res.status(500).json({ error: "Clé API tennis manquante. Le direct tennis n'est pas disponible pour le moment." });
  }

  try {
    const rawMatches = await getLiveMatches(key);
    const matches = rawMatches
      .map((m) => mapMatchToLiveState(m, null))
      .filter((m) => m.homeTeam.name && m.awayTeam.name)
      .map((m) => ({ ...m, pronostic: { available: false } }));

    // Même mécanisme que les autres sports : le CDN Vercel mutualise les réponses
    // entre toutes les instances/visiteurs pendant quelques secondes, pour que
    // l'actualisation fréquente côté client ne multiplie pas les appels réels vers
    // Live Tennis API (déjà protégés par le cache serveur de 60s, voir provider.js).
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json({ matches });
  } catch (e) {
    console.error("Erreur /api/tennis/live-matches:", e.message);
    return res.status(502).json({ error: "Le direct tennis n'est pas disponible pour le moment. Réessaie dans quelques minutes." });
  }
}
