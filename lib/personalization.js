// Historique de recherche et compétitions favorites, personnels à chaque compte (voir
// supabase/migrations/0008_custom_auth.sql) — toute la lecture/écriture passe
// désormais par pages/api/search-history.js et pages/api/favorites.js (jamais un
// appel Supabase direct depuis le navigateur, voir PROMPT point 6) : ces fonctions ne
// sont plus qu'un simple enrobage de fetch(), l'isolation entre comptes est garantie
// côté serveur par le filtrage sur profile_id (déduit de la session, jamais d'un id
// passé ici). Toute erreur est journalisée mais n'interrompt jamais le reste de
// l'application — la personnalisation est un complément, pas une dépendance.
//
// `userId` reste le premier paramètre de chaque fonction pour ne pas casser les
// appelants existants (pages/index.js) : il ne sert plus qu'à savoir "y a-t-il une
// session ?" (les routes API lisent la session elles-mêmes pour le filtrage réel).

import { readPrefs, writePrefs } from "./prefsCookie";

export async function getRecentSearches(userId) {
  if (!userId) return [];
  try {
    const r = await fetch("/api/search-history");
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      console.error("Erreur lecture historique de recherche:", data?.error || r.status);
      return [];
    }
    return data?.queries || [];
  } catch (e) {
    console.error("Erreur lecture historique de recherche:", e.message);
    return [];
  }
}

export async function saveSearch(userId, query) {
  const q = (query || "").trim();
  if (!userId || q.length < 2) return;
  try {
    const r = await fetch("/api/search-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => null);
      console.error("Erreur sauvegarde recherche:", data?.error || r.status);
    }
  } catch (e) {
    console.error("Erreur sauvegarde recherche:", e.message);
  }
}

export async function getFavoriteCompetitionCodes(userId) {
  if (!userId) return new Set();
  try {
    const r = await fetch("/api/favorites");
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      console.error("Erreur lecture favoris:", data?.error || r.status);
      return new Set();
    }
    return new Set(data?.codes || []);
  } catch (e) {
    console.error("Erreur lecture favoris:", e.message);
    return new Set();
  }
}

export async function addFavoriteCompetition(userId, code, label) {
  if (!userId || !code) return;
  try {
    const r = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, label }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => null);
      console.error("Erreur ajout favori:", data?.error || r.status);
      return;
    }
    // Mémorise aussi dans blume_prefs (voir PROMPT Partie 2) : un simple cache
    // d'affichage pour un rendu instantané la prochaine fois, la table Supabase
    // reste la source de vérité (voir pages/api/favorites.js).
    const current = readPrefs().favoriteCompetitions;
    if (!current.includes(code)) writePrefs({ favoriteCompetitions: [...current, code] });
  } catch (e) {
    console.error("Erreur ajout favori:", e.message);
  }
}

export async function removeFavoriteCompetition(userId, code) {
  if (!userId || !code) return;
  try {
    const r = await fetch("/api/favorites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => null);
      console.error("Erreur suppression favori:", data?.error || r.status);
      return;
    }
    writePrefs({ favoriteCompetitions: readPrefs().favoriteCompetitions.filter((c) => c !== code) });
  } catch (e) {
    console.error("Erreur suppression favori:", e.message);
  }
}
