import { getSession } from "../../lib/session";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { guardMutation } from "../../lib/security/guardMutation";

// Historique de recherche, personnel à chaque compte, filtré par profile_id (voir
// supabase/migrations/0008_custom_auth.sql) — route SERVEUR exclusivement, même
// principe que pages/api/match-history.js : `profile_id` vient TOUJOURS de la
// session vérifiée (lib/session.js#getSession), jamais du corps de la requête.
const RECENT_SEARCHES_LIMIT = 8;

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Non connecté." });

  if (req.method === "POST") {
    if (!guardMutation(req, res, "search-history-post", { limit: 60 })) return;
    const query = (req.body?.query || "").trim();
    if (query.length < 2) return res.status(400).json({ error: "Recherche trop courte." });
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin.from("search_history").insert({ profile_id: session.id, query });
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
        .from("search_history")
        .select("query")
        .eq("profile_id", session.id)
        .order("created_at", { ascending: false })
        .limit(RECENT_SEARCHES_LIMIT * 3);
      if (error) return res.status(500).json({ error: error.message, queries: [] });

      const seen = new Set();
      const distinct = [];
      for (const row of data || []) {
        const q = (row.query || "").trim();
        if (!q || seen.has(q.toLowerCase())) continue;
        seen.add(q.toLowerCase());
        distinct.push(q);
        if (distinct.length >= RECENT_SEARCHES_LIMIT) break;
      }
      return res.status(200).json({ queries: distinct });
    } catch (e) {
      return res.status(500).json({ error: e.message, queries: [] });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Méthode non autorisée." });
}
