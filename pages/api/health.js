import { supabaseAnon } from "../../lib/supabaseAnon";

// Anti-pause Supabase — équivalent, testable à la main, du workflow programmé
// .github/workflows/supabase-keepalive.yml (tous les 2 jours) : Supabase (plan
// gratuit) met un projet en pause après une période d'inactivité sur la base, donc
// une requête HTTP seule (sur une page statique, par exemple) ne suffit pas — il faut
// une vraie requête vers la base. Une seule colonne, une seule ligne (`limit(1)`),
// pour que ça compte comme activité réelle sans consommer de bande passante.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { error } = await supabaseAnon.from("profiles").select("id").limit(1);
    if (error) {
      console.error("Échec du contrôle de santé Supabase :", error.message);
      return res.status(502).json({ ok: false, error: error.message });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Échec du contrôle de santé Supabase :", e.message);
    return res.status(502).json({ ok: false, error: e.message });
  }
}
