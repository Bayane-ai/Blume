import { getSession } from "../../lib/session";
import { isAdmin } from "../../lib/auth/admin";

// Route de LECTURE seule : répond uniquement "est-ce que la session ACTUELLE de
// l'appelant est celle de l'administrateur ?" (un simple booléen) — jamais ADMIN_EMAIL
// lui-même, jamais l'identité de l'administrateur pour qui que ce soit d'autre. Sert
// uniquement à afficher (ou non) le lien "Admin" dans la navigation (voir
// components/SiteHeader.js) : un simple confort d'affichage, jamais la protection
// elle-même (la vraie protection est le contrôle serveur de /admin et des routes
// d'écriture, voir lib/auth/admin.js).
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ isOwner: isAdmin(getSession(req)) });
}
