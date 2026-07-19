import { supabase } from "./supabaseClient";

// Historique de recherche et favoris personnels à chaque compte (table
// search_history / favorites, protégées par des règles RLS — voir
// supabase/migrations/0001_personalization.sql). Toute erreur (ex: la migration n'a
// pas encore été exécutée, ou le client Supabase n'est pas disponible) est
// journalisée mais n'interrompt jamais le reste de l'application : la
// personnalisation est un complément, pas une dépendance.
const RECENT_SEARCHES_LIMIT = 8;

export async function getRecentSearches(userId) {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from("search_history")
      .select("query")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(RECENT_SEARCHES_LIMIT * 3);
    if (error) {
      console.error("Erreur lecture historique de recherche:", error.message);
      return [];
    }
    const seen = new Set();
    const distinct = [];
    for (const row of data || []) {
      const q = (row.query || "").trim();
      if (!q || seen.has(q.toLowerCase())) continue;
      seen.add(q.toLowerCase());
      distinct.push(q);
      if (distinct.length >= RECENT_SEARCHES_LIMIT) break;
    }
    return distinct;
  } catch (e) {
    console.error("Erreur lecture historique de recherche:", e.message);
    return [];
  }
}

export async function saveSearch(userId, query) {
  const q = (query || "").trim();
  if (!userId || q.length < 2) return;
  try {
    const { error } = await supabase.from("search_history").insert({ user_id: userId, query: q });
    if (error) console.error("Erreur sauvegarde recherche:", error.message);
  } catch (e) {
    console.error("Erreur sauvegarde recherche:", e.message);
  }
}

export async function getFavoriteCompetitionCodes(userId) {
  if (!userId) return new Set();
  try {
    const { data, error } = await supabase
      .from("favorites")
      .select("ref_id")
      .eq("user_id", userId)
      .eq("kind", "competition");
    if (error) {
      console.error("Erreur lecture favoris:", error.message);
      return new Set();
    }
    return new Set((data || []).map((r) => r.ref_id));
  } catch (e) {
    console.error("Erreur lecture favoris:", e.message);
    return new Set();
  }
}

export async function addFavoriteCompetition(userId, code, label) {
  if (!userId || !code) return;
  try {
    const { error } = await supabase
      .from("favorites")
      .insert({ user_id: userId, kind: "competition", ref_id: code, label: label || code });
    if (error) console.error("Erreur ajout favori:", error.message);
  } catch (e) {
    console.error("Erreur ajout favori:", e.message);
  }
}

export async function removeFavoriteCompetition(userId, code) {
  if (!userId || !code) return;
  try {
    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", userId)
      .eq("kind", "competition")
      .eq("ref_id", code);
    if (error) console.error("Erreur suppression favori:", error.message);
  } catch (e) {
    console.error("Erreur suppression favori:", e.message);
  }
}
