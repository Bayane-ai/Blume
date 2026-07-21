// "Historique" (voir PROMPT) : journal, CÔTÉ NAVIGATEUR, des matchs dont la personne a
// déjà ouvert l'analyse/les pronostics — contrairement à pronostic_history (Supabase,
// partagé entre tous les visiteurs, utilisé par les pages "Probabilités
// réussies/échouées"), c'est un journal personnel de navigation : localStorage suffit,
// aucune vérification serveur n'est nécessaire, seulement retenir CE que cette personne
// a déjà consulté. Chaque entrée reprend exactement la forme d'un objet "match" tel
// qu'utilisé par components/MatchCard.js (matchHref) et components/MatchInfoBlock.js,
// pour pouvoir aussi bien réafficher la carte que reconstruire le lien vers la page du
// match sans transformation supplémentaire.
const STORAGE_KEY = "blume:match-history";
// "s'efface automatiquement au bout d'une semaine et demie (environ 10 jours)".
const EXPIRY_MS = 10 * 24 * 3600 * 1000;
const MAX_ENTRIES = 100;

function readAll() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error("Erreur lecture historique des matchs consultés:", e);
    return [];
  }
}

function writeAll(list) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("Erreur écriture historique des matchs consultés:", e);
  }
}

// Retire les entrées ajoutées il y a plus de EXPIRY_MS — basé sur le moment où la
// personne a consulté le match (`addedAt`), jamais sur la date du match lui-même :
// l'historique doit survivre à la fin du match (voir PROMPT, "n'est PAS effacé par la
// fin du match").
function pruneExpired(list) {
  const cutoff = Date.now() - EXPIRY_MS;
  return list.filter((entry) => Number.isFinite(entry?.addedAt) && entry.addedAt >= cutoff);
}

// Liste les matchs consultés, du plus récent au plus ancien, après avoir nettoyé les
// entrées expirées (et persisté ce nettoyage).
export function listMatchHistory() {
  const pruned = pruneExpired(readAll());
  writeAll(pruned);
  return pruned;
}

// Ajoute un match tout juste ouvert en tête de l'historique — voir PROMPT "évite les
// doublons" : si ce match y figurait déjà, l'ancienne entrée est retirée avant de
// réinsérer la nouvelle en tête, ce qui à la fois le remonte en haut ET remet son délai
// d'effacement à zéro (`addedAt` toujours régénéré ici).
export function addMatchToHistory(entry) {
  if (!entry?.id || !entry?.homeTeam?.name || !entry?.awayTeam?.name) return;
  const withoutDupe = pruneExpired(readAll()).filter((e) => String(e.id) !== String(entry.id));
  const next = [{ ...entry, id: String(entry.id), addedAt: Date.now() }, ...withoutDupe].slice(0, MAX_ENTRIES);
  writeAll(next);
}
