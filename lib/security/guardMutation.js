import { isSameOriginRequest } from "./sameOrigin";
import { checkRateLimit } from "./rateLimit";

// Garde-fou commun à TOUTE route de mutation (POST/PUT/PATCH/DELETE) du site, qu'elle
// soit réservée au propriétaire ou non : vérifie l'origine (CSRF, voir sameOrigin.js)
// PUIS le débit par IP (voir rateLimit.js), dans cet ordre — une requête cross-origin
// est rejetée avant même de compter contre le quota de qui que ce soit. Écrit
// directement la réponse HTTP et renvoie `false` dès qu'un contrôle échoue : l'appelant
// doit alors arrêter immédiatement ("if (!guardMutation(...)) return;"), jamais
// continuer le traitement.
export function guardMutation(req, res, routeKey, rateLimitOptions) {
  if (!isSameOriginRequest(req)) {
    res.status(403).json({ error: "Non autorisé" });
    return false;
  }
  if (!checkRateLimit(req, routeKey, rateLimitOptions)) {
    res.status(429).json({ error: "Trop de requêtes, réessaie plus tard." });
    return false;
  }
  return true;
}
