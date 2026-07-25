// "Historique" (voir PROMPT Bloc 3) : les matchs dont un COMPTE a déjà ouvert
// l'analyse/les pronostics — personnel à chaque utilisateur, stocké dans la table
// match_history (voir supabase/migrations/0008_custom_auth.sql). Toute la lecture/
// écriture passe désormais par pages/api/match-history.js (jamais un appel Supabase
// direct depuis le navigateur, voir PROMPT point 6) : ce module n'est plus qu'un
// simple enrobage de fetch(), l'isolation entre comptes est garantie côté serveur par
// le filtrage sur profile_id (déduit de la session, jamais d'un id passé ici). Toute
// erreur (réseau, session expirée...) est journalisée mais n'interrompt jamais le
// reste de l'application — la personnalisation est un complément, pas une dépendance.

// Ajoute un match tout juste ouvert en tête de l'historique DU COMPTE CONNECTÉ — le
// premier paramètre (userId) n'est plus utilisé pour filtrer quoi que ce soit (la
// route API lit la session elle-même) : conservé uniquement pour ne pas casser les
// appelants existants (pages/match/[id].js) sans qu'il soit nécessaire de les
// modifier un par un.
export async function addMatchToHistory(userId, entry) {
  if (!userId || !entry?.id || !entry?.homeTeam?.name || !entry?.awayTeam?.name) return;
  try {
    const r = await fetch("/api/match-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => null);
      console.error("Erreur sauvegarde historique des matchs consultés:", data?.error || r.status);
    }
  } catch (e) {
    console.error("Erreur sauvegarde historique des matchs consultés:", e.message);
  }
}

// Liste les matchs consultés par le compte connecté, du plus récent au plus ancien —
// la route API nettoie elle-même les entrées de plus de 10 jours avant de répondre.
export async function listMatchHistory(userId) {
  if (!userId) return [];
  try {
    const r = await fetch("/api/match-history");
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      console.error("Erreur lecture historique des matchs consultés:", data?.error || r.status);
      return [];
    }
    return data?.items || [];
  } catch (e) {
    console.error("Erreur lecture historique des matchs consultés:", e.message);
    return [];
  }
}
