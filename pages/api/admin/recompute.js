import { getSession } from "../../../lib/session";
import { requireAdmin, AdminRequiredError } from "../../../lib/auth/admin";
import { guardMutation } from "../../../lib/security/guardMutation";
import { maintainAndGetComboStats } from "../../../lib/comboHistory";
import { listAndMaintainHistory, listRecentPredictionsForDuplicateCheck } from "../../../lib/pronosticHistory";
import { warnOnDuplicateLineSets } from "../../../lib/lineDuplicateCheck";

// Exemple concret d'action d'ADMINISTRATION (voir PROMPT étape 5 : "déclenchement de
// recalcul") : force le nettoyage des entrées expirées et la revérification des
// pronostics/combinés encore en attente (normalement déclenché automatiquement au
// chargement des pages concernées, voir pages/api/pronostic-history.js et
// pages/api/combo-history.js) — réservé au propriétaire, jamais un visiteur ordinaire.
//
// requireAdmin() en tout premier, avant même de lire le corps de la requête ou de
// toucher à quoi que ce soit : AUCUNE exception. Message de refus générique (jamais
// "tu n'es pas <email de l'administrateur>"), même code 403 qu'un visiteur non
// connecté. Être connecté (avoir une session valide) ne suffit pas : seul le compte
// dont l'email correspond à ADMIN_EMAIL passe ce contrôle (voir lib/auth/admin.js).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    requireAdmin(getSession(req));
  } catch (e) {
    if (e instanceof AdminRequiredError) return res.status(403).json({ error: "Non autorisé" });
    return res.status(500).json({ error: "Erreur serveur." });
  }

  // CSRF/origine + débit — après requireAdmin() : un appel qui n'est même pas
  // authentifié comme administrateur ne doit jamais avancer jusqu'ici, mais un
  // compte administrateur compromis reste lui aussi soumis à ces protections.
  if (!guardMutation(req, res, "admin-recompute", { limit: 10 })) return;

  const token = process.env.FOOTBALL_DATA_TOKEN;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;

  try {
    const [comboStats, pronosticSuccess, pronosticFailure, recentPredictions] = await Promise.all([
      maintainAndGetComboStats([], token, apiFootballKey),
      listAndMaintainHistory("success", token, apiFootballKey),
      listAndMaintainHistory("failure", token, apiFootballKey),
      listRecentPredictionsForDuplicateCheck(),
    ]);
    // BLOC 2 (lib/pronosticFromProfiles.js) — VÉRIFICATION AUTOMATIQUE OBLIGATOIRE :
    // compare les lignes de TOUS les pronostics récemment affichés, deux à deux —
    // jamais masqué, journalisé bruyamment (voir lib/lineDuplicateCheck.js) ET renvoyé
    // ici pour que l'administration le voie directement, sans avoir à fouiller les logs.
    const duplicateLineWarnings = warnOnDuplicateLineSets(recentPredictions, { context: "admin-recompute" });
    return res.status(200).json({
      comboSuccessRates: comboStats.successRates,
      pronosticCounts: { success: pronosticSuccess.length, failure: pronosticFailure.length },
      duplicateLineWarnings,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
