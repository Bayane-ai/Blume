// Même principe que liveMatchCache.js, mais pour la liste globale des matchs en
// direct : un seul appel en amont par fenêtre de quelques secondes, partagé par tous
// les visiteurs de la page "Matchs en ligne", au lieu d'un appel par visiteur.
import { recordLastError } from "./apiQuota";
import { readPersistentCache, writePersistentCache } from "./apiSportsCache";

const BASE = "https://api.football-data.org/v4";
const SOURCE_KEY = "football-data";
const PERSISTENT_CACHE_KEY = "football-data:live_all";
const CACHE_TTL_MS = 2500; // 2,5s : liste des matchs en direct réactualisée très régulièrement
// Statuts correspondant à un match réellement en cours (l'API football-data.org
// accepte aussi le raccourci "LIVE", gardé ici en plus par sécurité, mais IN_PLAY et
// PAUSED — mi-temps — sont les vrais statuts de match individuels à filtrer).
const LIVE_STATUS_FILTER = "LIVE,IN_PLAY,PAUSED";
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED", "LIVE"]);
// Taille de page imposée par football-data.org, et borne de sécurité contre une
// pagination mal formée (2000 matchs en direct simultanés n'existent pas).
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

let cachedResult = null; // { matches } | { errorStatus }
let cachedAt = 0;
let inFlight = null; // promesse en cours, pour que des requêtes simultanées (plusieurs
// visiteurs qui actualisent au même instant) partagent le même appel en amont au lieu
// d'en déclencher un chacune.

export async function getLiveMatchesList(token) {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // dateFrom/dateTo explicites (hier → demain, en UTC) : sans eux, l'API applique
      // une fenêtre de dates par défaut qui peut exclure un match pourtant en cours
      // (ex : match commencé juste avant/après minuit UTC) — même principe que
      // pages/api/matches.js, qui fixe déjà sa propre fenêtre pour la même raison.
      const dateFrom = isoDate(new Date(Date.now() - 24 * 3600000));
      const dateTo = isoDate(new Date(Date.now() + 24 * 3600000));
      // PAGINATION COMPLÈTE : `limit` plafonne chaque page à 100 résultats. Ne lire que
      // la première page tronquait la liste dès qu'un créneau chargé dépassait ce seuil
      // — et coupait en priorité les petites compétitions, classées après les grandes
      // dans l'ordre interne de l'API. Même correctif que pages/api/matches.js.
      const collected = [];
      let offset = 0;
      let r = null;
      for (let i = 0; i < MAX_PAGES; i += 1) {
        r = await fetch(
          `${BASE}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=${LIVE_STATUS_FILTER}&limit=${PAGE_SIZE}&offset=${offset}`,
          { headers: { "X-Auth-Token": token } }
        );
        if (!r.ok) break; // traité juste en dessous, avec les pages déjà obtenues
        const page = await r.json();
        const batch = page?.matches || [];
        collected.push(...batch);
        const total = Number(page?.resultSet?.count);
        if (batch.length < PAGE_SIZE || (Number.isFinite(total) && collected.length >= total)) break;
        offset += PAGE_SIZE;
      }
      // Une page suivante en erreur ne jette jamais les précédentes : un résultat
      // partiel réel vaut mieux qu'un écran vide.
      if (!r.ok && collected.length > 0) {
        console.warn(`[football-data] pagination live interrompue à l'offset ${offset} (HTTP ${r.status}) — ${collected.length} match(s) conservé(s)`);
      } else if (!r.ok) {
        // Jamais avalée silencieusement (voir PROMPT : "aucune erreur ne doit être
        // silencieusement transformée en liste vide") — le corps de la réponse
        // football-data.org précise la vraie cause (jeton invalide, quota dépassé...).
        const body = typeof r.text === "function" ? await r.text().catch(() => "") : "";
        const message = `football-data.org a répondu ${r.status} sur /matches (live) : ${body.slice(0, 300)}`;
        console.error(`[football-data] ${message}`);
        recordLastError(SOURCE_KEY, message);
        // En cas d'erreur passagère (quota, réseau), on préfère resservir la dernière
        // liste connue plutôt que de faire disparaître tous les matchs à l'écran —
        // d'abord le cache en mémoire (cette instance), puis le cache persistant
        // (partagé entre toutes les instances/cold starts, voir lib/apiSportsCache.js)
        // avant de conclure à un vrai échec total.
        if (cachedResult && cachedResult.matches) return cachedResult;
        const persisted = await readPersistentCache(PERSISTENT_CACHE_KEY);
        if (persisted) {
          cachedResult = { matches: persisted.payload, stale: true, lastUpdated: new Date(persisted.fetchedAt).toISOString() };
          cachedAt = Date.now();
          return cachedResult;
        }
        cachedResult = { errorStatus: r.status };
        cachedAt = Date.now();
        return cachedResult;
      }
      // Filtre défensif : même si la fenêtre de dates ci-dessus ramène des matchs
      // programmés/terminés ce jour-là, on ne garde que ceux réellement en cours —
      // jamais un match à venir ou terminé affiché comme "en direct". C'est le SEUL
      // filtre appliqué ici : aucune restriction de ligue, de pays ni de division.
      const matches = collected.filter((m) => LIVE_STATUSES.has(m.status));
      cachedResult = { matches };
      cachedAt = Date.now();
      writePersistentCache(PERSISTENT_CACHE_KEY, matches);
      return cachedResult;
    } catch (e) {
      console.error(`[football-data] Échec réseau /matches (live) : ${e.message}`);
      recordLastError(SOURCE_KEY, `Échec réseau : ${e.message}`);
      if (cachedResult && cachedResult.matches) return cachedResult;
      const persisted = await readPersistentCache(PERSISTENT_CACHE_KEY);
      if (persisted) {
        cachedResult = { matches: persisted.payload, stale: true, lastUpdated: new Date(persisted.fetchedAt).toISOString() };
        cachedAt = Date.now();
        return cachedResult;
      }
      cachedResult = { errorStatus: 500 };
      cachedAt = Date.now();
      return cachedResult;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
