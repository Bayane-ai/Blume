import { getSession } from "../../lib/session";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { guardMutation } from "../../lib/security/guardMutation";

// Compétitions favorites, personnelles à chaque compte, filtrées par profile_id (voir
// supabase/migrations/0008_custom_auth.sql) — route SERVEUR exclusivement, même
// principe que pages/api/match-history.js et pages/api/search-history.js.
export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Non connecté." });

  if (req.method === "POST") {
    if (!guardMutation(req, res, "favorites-post", { limit: 60 })) return;
    const { code, label } = req.body || {};
    if (!code) return res.status(400).json({ error: "Compétition invalide." });
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin
        .from("favorites")
        .upsert(
          { profile_id: session.id, kind: "competition", ref_id: code, label: label || code },
          { onConflict: "profile_id,kind,ref_id" }
        );
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    if (!guardMutation(req, res, "favorites-delete", { limit: 60 })) return;
    const code = req.body?.code || req.query?.code;
    if (!code) return res.status(400).json({ error: "Compétition invalide." });
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin
        .from("favorites")
        .delete()
        .eq("profile_id", session.id)
        .eq("kind", "competition")
        .eq("ref_id", code);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "GET") {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin
        .from("favorites")
        .select("ref_id")
        .eq("profile_id", session.id)
        .eq("kind", "competition");
      if (error) return res.status(500).json({ error: error.message, codes: [] });
      return res.status(200).json({ codes: (data || []).map((r) => r.ref_id) });
    } catch (e) {
      return res.status(500).json({ error: e.message, codes: [] });
    }
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Méthode non autorisée." });
}
