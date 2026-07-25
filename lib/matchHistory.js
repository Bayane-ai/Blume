import { supabase } from "./supabaseClient";

// "Historique" (voir PROMPT Bloc 3) : les matchs dont un COMPTE a déjà ouvert
// l'analyse/les pronostics — personnel à chaque utilisateur (voir PROMPT Bloc 4 :
// "chaque utilisateur connecté ne voit QUE ses propres données"), stocké dans la table
// match_history (Row Level Security : auth.uid() = user_id, voir
// supabase/migrations/0006_match_history.sql), jamais dans le navigateur : un compte
// retrouve donc son historique sur n'importe quel appareil. Toute erreur (migration
// pas encore exécutée, réseau...) est journalisée mais n'interrompt jamais le reste de
// l'application — la personnalisation est un complément, pas une dépendance.
const EXPIRY_DAYS = 10;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 3600 * 1000;

function toDbRow(userId, entry) {
  return {
    user_id: userId,
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

// Ajoute un match tout juste ouvert en tête de l'historique DE CE COMPTE — un upsert
// sur (user_id, match_id) : si ce match y figurait déjà, la ligne existante est mise à
// jour (jamais un doublon), avec un nouveau `added_at`, ce qui la remonte en tête et
// remet son délai d'effacement à zéro.
export async function addMatchToHistory(userId, entry) {
  if (!userId || !entry?.id || !entry?.homeTeam?.name || !entry?.awayTeam?.name) return;
  try {
    const { error } = await supabase
      .from("match_history")
      .upsert(toDbRow(userId, entry), { onConflict: "user_id,match_id" });
    if (error) console.error("Erreur sauvegarde historique des matchs consultés:", error.message);
  } catch (e) {
    console.error("Erreur sauvegarde historique des matchs consultés:", e.message);
  }
}

// Liste les matchs consultés par CE COMPTE, du plus récent au plus ancien — après
// avoir nettoyé les entrées de plus de 10 jours (basé sur `added_at`, jamais sur la
// date du match lui-même : l'historique doit survivre à la fin du match).
export async function listMatchHistory(userId) {
  if (!userId) return [];
  try {
    const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
    await supabase.from("match_history").delete().eq("user_id", userId).lt("added_at", cutoff);

    const { data, error } = await supabase
      .from("match_history")
      .select("*")
      .eq("user_id", userId)
      .order("added_at", { ascending: false });
    if (error) {
      console.error("Erreur lecture historique des matchs consultés:", error.message);
      return [];
    }
    return (data || []).map(fromDbRow);
  } catch (e) {
    console.error("Erreur lecture historique des matchs consultés:", e.message);
    return [];
  }
}
