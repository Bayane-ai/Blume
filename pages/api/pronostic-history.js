import { listAndMaintainHistory } from "../../lib/pronosticHistory";

// Alimente les pages "Probabilités réussies" / "Probabilités échouées" — voir
// lib/pronosticHistory.js pour la logique (nettoyage des entrées de plus de 5 jours et
// revérification des matchs encore "pending", effectués à chaque appel, donc à chaque
// chargement de l'une de ces deux pages).
export default async function handler(req, res) {
  const status = req.query.status === "failure" ? "failure" : "success";
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;

  try {
    const items = await listAndMaintainHistory(status, token, apiFootballKey);
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message, items: [] });
  }
}
