import { saveComboPredictions, maintainAndGetComboStats } from "../../lib/comboHistory";

// BLOC 4.B "Suivi dans le temps" — deux usages depuis pages/combine-vision.js :
//   - POST : enregistre les combinés fraîchement générés côté client ("pending"),
//     voir lib/comboHistory.js#saveComboPredictions.
//   - GET  : nettoie les entrées expirées, revérifie les combinés en attente dont
//     tous les matchs sont désormais terminés, puis renvoie le taux de réussite par
//     niveau de risque et le statut (Gagné/Perdu/En cours) des combinés actuellement
//     affichés (`ids`, une liste d'identifiants séparés par des virgules).
export default async function handler(req, res) {
  if (req.method === "POST") {
    const combos = req.body?.combos;
    if (!Array.isArray(combos)) return res.status(400).json({ error: "Paramètre \"combos\" manquant" });
    await saveComboPredictions(combos);
    return res.status(200).json({ saved: true });
  }

  const token = process.env.FOOTBALL_DATA_TOKEN;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  const idsParam = req.query?.ids;
  const comboIds = typeof idsParam === "string" && idsParam.length > 0 ? idsParam.split(",") : [];

  try {
    const { successRates, statuses } = await maintainAndGetComboStats(comboIds, token, apiFootballKey);
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    return res.status(200).json({ successRates, statuses });
  } catch (e) {
    return res.status(500).json({ error: e.message, successRates: {}, statuses: {} });
  }
}
