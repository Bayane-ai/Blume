import { settleFinishedPredictionsNow } from "../../../lib/pronosticHistory";

// RÈGLEMENT AUTOMATIQUE DE FIN DE MATCH (PROMPT) : point d'entrée dédié pour Vercel
// Cron (voir vercel.json), qui balaie TOUS les pronostics encore "pending" et classe
// ceux dont le match est réellement terminé — indépendamment de toute visite du site
// (contrairement au balayage opportuniste, voir lib/pronosticHistory.js#
// maybeSweepFinishedPredictions, déclenché par le trafic normal). Les deux mécanismes
// se complètent : celui-ci fonctionne même si personne ne visite le site, l'autre
// réagit plus vite (dès la prochaine requête) si quelqu'un le visite entre deux
// exécutions du cron.
//
// Sécurisé par CRON_SECRET (convention Vercel officielle : Vercel ajoute lui-même
// l'en-tête "Authorization: Bearer <CRON_SECRET>" à ses propres appels programmés dès
// que cette variable d'environnement est configurée) — sans elle, cette route reste
// fermée : jamais un endpoint public capable de déclencher des appels API à volonté
// (risque de vider le quota football-data.org/API-Football sur demande).
export default async function handler(req, res) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) return res.status(500).json({ error: "CRON_SECRET non configuré" });
  if (req.headers.authorization !== `Bearer ${configuredSecret}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const token = process.env.FOOTBALL_DATA_TOKEN;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  try {
    await settleFinishedPredictionsNow(token, apiFootballKey);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
