import { getSession } from "../../../lib/session";
import { requireAdmin, AdminRequiredError } from "../../../lib/auth/admin";
import { guardMutation } from "../../../lib/security/guardMutation";
import { getOrRefreshTeamProfile } from "../../../lib/teamStatProfiles";

// BLOC 1 (profils statistiques par équipe, voir lib/teamStatProfiles.js) : point
// d'entrée pour consulter/déclencher le calcul du profil réel d'UNE équipe — réservé à
// l'administration, comme pages/api/admin/recompute.js, le temps que le Bloc 2 (qui
// consommera ces profils pour générer les lignes de pronostics) ne soit fait ; cette
// route n'est donc appelée par aucune page publique pour l'instant.
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

  // POST (pas GET) + guardMutation : ce calcul déclenche de vrais appels API-Football
  // et une écriture Supabase en effet de bord (voir lib/teamStatProfiles.js) — jamais
  // exposé comme un simple GET qui pourrait être déclenché par un lien/une image
  // (CSRF), même principe que pages/api/admin/recompute.js.
  if (!guardMutation(req, res, "admin-team-profile", { limit: 20 })) return;

  const teamName = typeof req.body?.teamName === "string" ? req.body.teamName.trim() : "";
  if (!teamName) return res.status(400).json({ error: "Paramètre teamName manquant" });

  const competitionCode = typeof req.body?.competitionCode === "string" ? req.body.competitionCode : null;
  const competitionName = typeof req.body?.competitionName === "string" ? req.body.competitionName : null;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;

  try {
    const profile = await getOrRefreshTeamProfile({ teamName, competitionCode, competitionName, apiFootballKey });
    return res.status(200).json(profile);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
