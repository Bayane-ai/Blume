// Cache en mémoire (par instance de fonction serverless) des classements par compétition.
// Le plan gratuit football-data.org limite à 10 requêtes/minute : sans ce cache, précalculer
// les pronostics de tous les matchs affichés redemanderait le classement à chaque requête.
import { recordLastError } from "./apiQuota";

const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const SOURCE_KEY = "football-data";

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
    if (!r.ok) {
      // Jamais avalée silencieusement : un pronostic qui retombe systématiquement sur
      // l'estimation moyenne (au lieu du vrai classement) est indiscernable d'un bug
      // sans ce log — voir lib/apiQuota.js#getLastError, affiché sur /admin.
      const body = typeof r.text === "function" ? await r.text().catch(() => "") : "";
      const message = `football-data.org a répondu ${r.status} sur /competitions/${code}/standings : ${body.slice(0, 300)}`;
      console.error(`[football-data] ${message}`);
      recordLastError(SOURCE_KEY, message);
      return cached ? cached.table : null;
    }
    const data = await r.json();
    // Compétitions à groupes (ex : Coupe du Monde) : plusieurs tableaux de classement
    // (un par groupe). On les fusionne pour pouvoir retrouver n'importe quelle équipe,
    // quel que soit son groupe — sinon seules les équipes du premier groupe étaient trouvées.
    const table = (data.standings || []).flatMap((s) => s.table || []);
    cache.set(code, { table, fetchedAt: Date.now() });
    return table;
  } catch (e) {
    console.error(`[football-data] Échec réseau /competitions/${code}/standings : ${e.message}`);
    recordLastError(SOURCE_KEY, `Échec réseau standings (${code}) : ${e.message}`);
    return cached ? cached.table : null;
  }
}
