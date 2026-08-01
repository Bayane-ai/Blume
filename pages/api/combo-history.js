import { saveComboPredictions, maintainAndGetComboStats } from "../../lib/comboHistory";
import { guardMutation } from "../../lib/security/guardMutation";
import { getBasketballApiKey } from "../../lib/sports/basketball/provider";
import { getTennisApiKey } from "../../lib/sports/tennis/provider";

// BLOC 4.B / BLOC 5 "Suivi dans le temps" (étendu au multi-sport bloc 9) — deux usages
// depuis pages/combine-vision.js :
//   - POST : enregistre les combinés fraîchement générés côté client ("pending"),
//     voir lib/comboHistory.js#saveComboPredictions. Reste ouvert à tout visiteur
//     (c'est le bilan PUBLIC du site — voir supabase/migrations/0002/0004 — pas une
//     donnée personnelle à réserver au propriétaire), mais protégé contre l'abus
//     (CSRF/origine + débit par IP, voir lib/security/guardMutation.js) : verrou
//     "propriétaire unique" (2026) — bloque le pollution/spam de ce bilan public par
//     un script tiers, sans jamais bloquer un vrai visiteur du site.
//   - GET  : nettoie les entrées expirées, revérifie les combinés en attente (échec
//     immédiat dès qu'une sélection est perdue, voir BLOC 5), puis renvoie le taux de
//     réussite par niveau de risque et la progression détaillée (statut global +
//     résultat de chaque sélection) des combinés actuellement affichés (`ids`, une
//     liste d'identifiants séparés par des virgules) — un combiné peut mélanger les 3
//     sports, `ctx` regroupe donc les 3 jeux de clés API (une clé manquante ne bloque
//     jamais la vérification des sélections des autres sports).
export default async function handler(req, res) {
  if (req.method === "POST") {
    if (!guardMutation(req, res, "combo-history-post", { limit: 30 })) return;
    const combos = req.body?.combos;
    if (!Array.isArray(combos)) return res.status(400).json({ error: "Paramètre \"combos\" manquant" });
    await saveComboPredictions(combos);
    return res.status(200).json({ saved: true });
  }

  const ctx = {
    token: process.env.FOOTBALL_DATA_TOKEN,
    apiFootballKey: process.env.API_FOOTBALL_KEY,
    basketballApiKey: getBasketballApiKey(),
    tennisApiKey: getTennisApiKey(),
  };
  const idsParam = req.query?.ids;
  const comboIds = typeof idsParam === "string" && idsParam.length > 0 ? idsParam.split(",") : [];

  try {
    const { successRates, progress } = await maintainAndGetComboStats(comboIds, ctx);
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    return res.status(200).json({ successRates, progress });
  } catch (e) {
    return res.status(500).json({ error: e.message, successRates: {}, progress: {} });
  }
}
