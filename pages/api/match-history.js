import { getSession } from "../../lib/session";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { guardMutation } from "../../lib/security/guardMutation";

// "Historique" (voir PROMPT point 6) : les matchs dont un COMPTE a déjà ouvert
// l'analyse/les pronostics — personnel à chaque utilisateur, filtré par profile_id
// (voir supabase/migrations/0008_custom_auth.sql). Route SERVEUR exclusivement : le
// navigateur n'appelle plus jamais Supabase directement pour cette table (voir
// lib/matchHistory.js, devenu un simple appel fetch() vers cette route) — la clé
// service_role (lib/supabaseAdmin.js) contourne la Row Level Security, c'est donc CE
// CODE qui garantit l'isolation entre comptes, jamais un identifiant fourni par le
// client : `profile_id` vient TOUJOURS de la session vérifiée (voir
// lib/session.js#getSession), jamais du corps de la requête.
const EXPIRY_DAYS = 10;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;

function toDbRow(profileId, entry) {
  return {
    profile_id: profileId,
    match_id: String(entry.id),
    status: entry.status || null,
    minute: entry.minute ?? null,
    utc_date: entry.utcDate || null,
    competition_code: entry.competition?.code || null,
    competition_name: entry.competition?.name || null,
    competition_emblem: entry.competition?.emblem || null,
    home_team_id: entry.homeTeam?.id != null ? String(entry.homeTeam.id) : null,
    home_team_name: entry.homeTeam?.name || null,
    home_team_crest: entry.homeTeam?.crest || null,
    away_team_id: entry.awayTeam?.id != null ? String(entry.awayTeam.id) : null,
    away_team_name: entry.awayTeam?.name || null,
    away_team_crest: entry.awayTeam?.crest || null,
    score_home: entry.score?.fullTime?.home ?? null,
    score_away: entry.score?.fullTime?.away ?? null,
    // Toujours régénéré : c'est ce qui remonte une entrée déjà présente en tête et
    // remet son délai d'effacement à zéro (voir PROMPT "évite les doublons").
    added_at: new Date().toISOString(),
  };
}

function fromDbRow(row) {
  return {
    id: row.match_id,
    status: row.status || "",
    minute: row.minute,
    utcDate: row.utc_date,
    competition: { code: row.competition_code || "", name: row.competition_name || "", emblem: row.competition_emblem || "" },
    homeTeam: { id: row.home_team_id || "", name: row.home_team_name || "", crest: row.home_team_crest || "" },
    awayTeam: { id: row.away_team_id || "", name: row.away_team_name || "", crest: row.away_team_crest || "" },
    score: { fullTime: { home: row.score_home, away: row.score_away } },
    addedAt: row.added_at ? new Date(row.added_at).getTime() : null,
  };
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Non connecté." });

  if (req.method === "POST") {
    if (!guardMutation(req, res, "match-history-post", { limit: 60 })) return;
    const entry = req.body?.entry;
    if (!entry?.id || !entry?.homeTeam?.name || !entry?.awayTeam?.name) {
      return res.status(400).json({ error: "Match invalide." });
    }
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin
        .from("match_history")
        .upsert(toDbRow(session.id, entry), { onConflict: "profile_id,match_id" });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "GET") {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
      await supabaseAdmin.from("match_history").delete().eq("profile_id", session.id).lt("added_at", cutoff);

      const { data, error } = await supabaseAdmin
        .from("match_history")
        .select("*")
        .eq("profile_id", session.id)
        .order("added_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message, items: [] });
      return res.status(200).json({ items: (data || []).map(fromDbRow) });
    } catch (e) {
      return res.status(500).json({ error: e.message, items: [] });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Méthode non autorisée." });
}
