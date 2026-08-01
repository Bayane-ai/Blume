import { listAndMaintainHistory } from "../../lib/pronosticHistory";
import { listAndMaintainHistory as listAndMaintainBasketballHistory, getBasketballApiKey } from "../../lib/sports/basketball/pronosticHistory";
import { listAndMaintainHistory as listAndMaintainTennisHistory, getTennisApiKey } from "../../lib/sports/tennis/pronosticHistory";

// Alimente les pages "Probabilités réussies" / "Probabilités échouées" — voir
// lib/pronosticHistory.js (football), lib/sports/basketball/pronosticHistory.js
// (basket) et lib/sports/tennis/pronosticHistory.js (tennis, bloc 8), même table
// Supabase, `sport` distinct pour la logique (nettoyage des entrées de plus de 5
// jours et revérification des matchs encore "pending", effectués à chaque appel, donc
// à chaque chargement de l'une de ces deux pages) — `sport=basketball`/`sport=tennis`
// bascule sur l'historique du sport concerné, football par défaut (comportement
// inchangé pour tout appel existant sans ce paramètre).
export default async function handler(req, res) {
  const status = req.query.status === "failure" ? "failure" : "success";
  const sport = req.query.sport === "basketball" || req.query.sport === "tennis" ? req.query.sport : "football";

  try {
    if (sport === "basketball") {
      const apiKey = getBasketballApiKey();
      const items = await listAndMaintainBasketballHistory(status, apiKey);
      res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
      return res.status(200).json({ items });
    }

    if (sport === "tennis") {
      const apiKey = getTennisApiKey();
      const items = await listAndMaintainTennisHistory(status, apiKey);
      res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
      return res.status(200).json({ items });
    }

    const token = process.env.FOOTBALL_DATA_TOKEN;
    const apiFootballKey = process.env.API_FOOTBALL_KEY;
    const items = await listAndMaintainHistory(status, token, apiFootballKey);
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message, items: [] });
  }
}
