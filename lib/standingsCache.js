// Cache en mémoire (par instance de fonction serverless) des classements par compétition.
// Le plan gratuit football-data.org limite à 10 requêtes/minute : sans ce cache, précalculer
// les pronostics de tous les matchs affichés redemanderait le classement à chaque requête.
const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

const cache = new Map(); // code -> { table, fetchedAt }

export async function getStandingsTable(code, token) {
  const cached = cache.get(code);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.table;
  }

  try {
    const r = await fetch(`${BASE}/competitions/${code}/standings`, {
      headers: { "X-Auth-Token": token },
    });
    if (!r.ok) return cached ? cached.table : null;
    const data = await r.json();
    const table = data.standings?.[0]?.table || [];
    cache.set(code, { table, fetchedAt: Date.now() });
    return table;
  } catch {
    return cached ? cached.table : null;
  }
}
