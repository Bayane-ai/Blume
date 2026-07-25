import { createSupabaseServerClient } from "../../lib/supabaseServer";
import { isOwner } from "../../lib/auth/owner";

// Route de LECTURE seule : répond uniquement "est-ce que la session ACTUELLE de
// l'appelant est celle du propriétaire ?" (un simple booléen) — jamais OWNER_ID ni
// OWNER_EMAIL eux-mêmes, jamais l'identité du propriétaire pour qui que ce soit
// d'autre. Sert uniquement à afficher (ou non) le lien "Admin" dans la navigation
// (voir components/SiteHeader.js) : un simple confort d'affichage, jamais la
// protection elle-même (la vraie protection est le contrôle serveur de /admin et des
// routes d'écriture, voir lib/auth/owner.js).
export default async function handler(req, res) {
  const supabase = createSupabaseServerClient(req, res);
  const { data: { user } } = await supabase.auth.getUser();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ isOwner: isOwner(user ? { user } : null) });
}
