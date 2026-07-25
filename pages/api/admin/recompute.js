import { createSupabaseServerClient } from "../../../lib/supabaseServer";
import { isOwner, requireOwner, OwnerRequiredError } from "../../../lib/auth/owner";
import { guardMutation } from "../../../lib/security/guardMutation";
import { maintainAndGetComboStats } from "../../../lib/comboHistory";
import { listAndMaintainHistory } from "../../../lib/pronosticHistory";

// Exemple concret d'action d'ADMINISTRATION (voir PROMPT étape 5 : "déclenchement de
// recalcul") : force le nettoyage des entrées expirées et la revérification des
// pronostics/combinés encore en attente (normalement déclenché automatiquement au
// chargement des pages concernées, voir pages/api/pronostic-history.js et
// pages/api/combo-history.js) — réservé au propriétaire, jamais un visiteur ordinaire.
//
// requireOwner() en tout premier, avant même de lire le corps de la requête ou de
// toucher à quoi que ce soit : AUCUNE exception. Message de refus générique (jamais
// "tu n'es pas <email du propriétaire>"), même code 403 qu'un visiteur non connecté.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const supabase = createSupabaseServerClient(req, res);
    const { data: { user } } = await supabase.auth.getUser();
    requireOwner(user ? { user } : null);
  } catch (e) {
    if (e instanceof OwnerRequiredError) return res.status(403).json({ error: "Non autorisé" });
    return res.status(500).json({ error: "Erreur serveur." });
  }

  // CSRF/origine + débit — après requireOwner() : un appel qui n'est même pas
  // authentifié comme propriétaire ne doit jamais avancer jusqu'ici, mais un compte
  // propriétaire compromis reste lui aussi soumis à ces protections.
  if (!guardMutation(req, res, "admin-recompute", { limit: 10 })) return;

  const token = process.env.FOOTBALL_DATA_TOKEN;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;

  try {
    const [comboStats, pronosticSuccess, pronosticFailure] = await Promise.all([
      maintainAndGetComboStats([], token, apiFootballKey),
      listAndMaintainHistory("success", token, apiFootballKey),
      listAndMaintainHistory("failure", token, apiFootballKey),
    ]);
    return res.status(200).json({
      comboSuccessRates: comboStats.successRates,
      pronosticCounts: { success: pronosticSuccess.length, failure: pronosticFailure.length },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
