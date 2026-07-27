// Même principe que liveMatchCache.js, mais pour la liste globale des matchs en
// direct : un seul appel en amont par fenêtre de quelques secondes, partagé par tous
// les visiteurs de la page "Matchs en ligne", au lieu d'un appel par visiteur.
const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 2500; // 2,5s : liste des matchs en direct réactualisée très régulièrement
// Statuts correspondant à un match réellement en cours (l'API football-data.org
// accepte aussi le raccourci "LIVE", gardé ici en plus par sécurité, mais IN_PLAY et
// PAUSED — mi-temps — sont les vrais statuts de match individuels à filtrer).
const LIVE_STATUS_FILTER = "LIVE,IN_PLAY,PAUSED";
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED", "LIVE"]);

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
      const r = await fetch(
        `${BASE}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=${LIVE_STATUS_FILTER}&limit=100`,
        { headers: { "X-Auth-Token": token } }
      );
      if (!r.ok) {
        // En cas d'erreur passagère (quota, réseau), on préfère resservir la dernière
        // liste connue plutôt que de faire disparaître tous les matchs à l'écran.
        if (cachedResult && cachedResult.matches) return cachedResult;
        cachedResult = { errorStatus: r.status };
        cachedAt = Date.now();
        return cachedResult;
      }
      const data = await r.json();
      // Filtre défensif : même si la fenêtre de dates ci-dessus ramène des matchs
      // programmés/terminés ce jour-là, on ne garde que ceux réellement en cours —
      // jamais un match à venir ou terminé affiché comme "en direct".
      const matches = (data.matches || []).filter((m) => LIVE_STATUSES.has(m.status));
      cachedResult = { matches };
      cachedAt = Date.now();
      return cachedResult;
    } catch (e) {
      if (cachedResult && cachedResult.matches) return cachedResult;
      cachedResult = { errorStatus: 500 };
      cachedAt = Date.now();
      return cachedResult;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
