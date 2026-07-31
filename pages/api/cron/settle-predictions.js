import { settleFinishedPredictionsNow } from "../../../lib/pronosticHistory";
import { settleFinishedPredictionsNow as settleBasketballPredictionsNow, getBasketballApiKey } from "../../../lib/sports/basketball/pronosticHistory";

// RÈGLEMENT AUTOMATIQUE DE FIN DE MATCH (PROMPT, football ; étendu au basket bloc 4) :
// point d'entrée dédié pour Vercel Cron (voir vercel.json), qui balaie TOUS les
// pronostics encore "pending" (football ET basket) et classe ceux dont le match est
// réellement terminé — indépendamment de toute visite du site (contrairement au
// balayage opportuniste, voir lib/pronosticHistory.js#maybeSweepFinishedPredictions et
// son équivalent basket, déclenchés par le trafic normal). Les deux sports sont
// balayés INDÉPENDAMMENT : la clé API d'un sport manquante ne bloque jamais le
// règlement de l'autre.
//
// Sécurisé par CRON_SECRET (convention Vercel officielle : Vercel ajoute lui-même
// l'en-tête "Authorization: Bearer <CRON_SECRET>" à ses propres appels programmés dès
// que cette variable d'environnement est configurée) — sans elle, cette route reste
// fermée : jamais un endpoint public capable de déclencher des appels API à volonté
// (risque de vider le quota football-data.org/API-Football/API-Basketball sur demande).
export default async function handler(req, res) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) return res.status(500).json({ error: "CRON_SECRET non configuré" });
  if (req.headers.authorization !== `Bearer ${configuredSecret}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const token = process.env.FOOTBALL_DATA_TOKEN;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  const basketballApiKey = getBasketballApiKey();

  if (!token && !basketballApiKey) {
    return res.status(500).json({ error: "Clé API manquante (football et basket)" });
  }

  const errors = [];
  if (token) {
    try {
      await settleFinishedPredictionsNow(token, apiFootballKey);
    } catch (e) {
      errors.push(`football: ${e.message}`);
    }
  }
  if (basketballApiKey) {
    try {
      await settleBasketballPredictionsNow(basketballApiKey);
    } catch (e) {
      errors.push(`basketball: ${e.message}`);
    }
  }

  if (errors.length) return res.status(500).json({ error: errors.join(" ; ") });
  return res.status(200).json({ ok: true });
}
