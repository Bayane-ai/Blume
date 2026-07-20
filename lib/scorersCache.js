// Vrais buteurs/passeurs de la saison en cours pour une compétition (endpoint dédié
// football-data.org /competitions/{code}/scorers) — sert de base réelle au bloc
// "Buteurs probables" (voir lib/probableScorers.js) : jamais un joueur inventé, les
// noms et les totaux affichés viennent directement de cette réponse. Même principe de
// cache que lib/standingsCache.js (20 minutes : cette liste ne change pas match par
// match, seulement au fil de la saison).
const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 20 * 60 * 1000;
// Le maximum autorisé par l'API : maximise les chances que les DEUX équipes du match
// aient des joueurs dans la liste (un classement de buteurs par défaut, plus court, ne
// remonterait souvent que les toutes meilleures attaques de la compétition).
const LIMIT = 100;

const cache = new Map(); // code -> { scorers, fetchedAt }

export async function getScorers(code, token) {
  const cached = cache.get(code);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.scorers;
  }

  try {
    const r = await fetch(`${BASE}/competitions/${code}/scorers?limit=${LIMIT}`, {
      headers: { "X-Auth-Token": token },
    });
    if (!r.ok) return cached ? cached.scorers : null;
    const data = await r.json();
    const scorers = data.scorers || [];
    cache.set(code, { scorers, fetchedAt: Date.now() });
    return scorers;
  } catch {
    return cached ? cached.scorers : null;
  }
}
