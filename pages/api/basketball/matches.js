// Matchs de basket À VENIR — aujourd'hui 00h00 UTC à J+7 23h59 UTC, toutes
// compétitions confondues, regroupés par compétition.
//
// Cette route ne renvoie JAMAIS d'erreur HTTP : toujours 200, avec la liste (même
// vide) ET un diagnostic exploitable. Elle renvoyait auparavant un 502 muet dès qu'UN
// SEUL des 8 jours échouait (Promise.all rejetait l'ensemble), faisant disparaître les
// 7 autres journées pourtant récupérées — c'est la cause du "échec (HTTP 502)" observé.
//
// Aucune liste blanche, aucun filtre de ligue, de pays, de catégorie ni de saison :
// WNBA, ligues d'été, championnats nationaux, coupes, jeunes et circuits secondaires
// passent tous. La seule restriction est la fenêtre de dates.
//
// Cascade de sources : API-Basketball d'abord ; si elle répond correctement mais sans
// aucun match, SportScore est interrogé automatiquement AVANT de conclure au vide
// (voir lib/sourceCascade.js).
import { getBasketballApiKey, getGamesByDate } from "../../../lib/sports/basketball/provider";
import { mapGameToUpcoming } from "../../../lib/sports/basketball/mapper";
import { isQuotaExhausted, getLastError } from "../../../lib/apiQuota";
import { readPersistentCache } from "../../../lib/apiSportsCache";
import { fetchSportScoreMatches, sportScoreToBlumeMatch } from "../../../lib/sportScore";
import { runCascade } from "../../../lib/sourceCascade";
import { readRouteCache, writeRouteCache } from "../../../lib/routeCache";

const NUM_DAYS = 8; // aujourd'hui + 7 jours

// Fenêtre ancrée sur MINUIT UTC (et non sur l'instant présent) : sans ça, un match
// programmé plus tôt aujourd'hui sortait de la fenêtre selon l'heure de la requête.
function utcDays() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: NUM_DAYS }, (_, i) =>
    new Date(start.getTime() + i * 24 * 3600000).toISOString().slice(0, 10)
  );
}

// Source 1 — API-Basketball, jour par jour. allSettled, jamais all : une journée en
// échec ne doit pas emporter les 7 autres (c'était l'origine du 502).
async function loadApiBasketball(dateStrings, key, window) {
  const perDate = await Promise.allSettled(dateStrings.map((d) => getGamesByDate(d, key)));

  const games = [];
  const failedDays = [];
  perDate.forEach((r, i) => {
    if (r.status === "fulfilled") games.push(...r.value);
    else failedDays.push({ date: dateStrings[i], error: r.reason?.message || String(r.reason) });
  });

  console.log(
    `[API-Basketball] /games?date= sur ${dateStrings.length} jours (${window.from} → ${window.to}) : ` +
      `${games.length} match(s) reçu(s), ${failedDays.length} jour(s) en échec` +
      (failedDays.length ? ` — ${failedDays.map((f) => `${f.date}: ${f.error}`).join(" | ")}` : "")
  );

  const matches = games.map(mapGameToUpcoming);
  // Toutes les journées en échec = la source n'a pas répondu. Sinon c'est un résultat
  // partiel mais valide, et la cascade peut le compléter.
  if (failedDays.length === dateStrings.length) {
    const err = new Error(failedDays[0]?.error || "Toutes les journées ont échoué");
    err.detail = failedDays;
    throw err;
  }
  return { matches, httpStatus: 200, partialFailures: failedDays };
}

// Source 2 (secours) — SportScore, sans clé. Son endpoint public ne prend qu'un sport
// et une limite : il ne remonte que des matchs récents/en cours, donc il ne remplace
// pas API-Basketball, mais il évite d'afficher "aucun match" quand le fournisseur
// principal répond à vide.
async function loadSportScore(sport) {
  const list = await fetchSportScoreMatches(sport);
  console.log(`[SportScore ${sport}] ${list.length} match(s) reçu(s) (source de secours)`);
  return { matches: list.map(sportScoreToBlumeMatch), httpStatus: 200 };
}

// Regroupe par compétition RÉELLEMENT présente : aucune liste fixée à l'avance.
function groupByCompetition(matches, { from, to }) {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T23:59:59Z`);
  const byCode = new Map();
  for (const m of matches) {
    if (!m.homeTeam?.name || !m.awayTeam?.name || !m.utcDate) continue;
    const t = Date.parse(m.utcDate);
    if (!Number.isFinite(t) || t < fromMs || t > toMs) continue;
    const code = m.competition?.code;
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, { name: m.competition.name, area: m.competition.area, matches: [] });
    byCode.get(code).matches.push({ ...m, pronostic: { available: false } });
  }
  return [...byCode.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([code, entry]) => ({ code, name: entry.name, area: entry.area, matches: entry.matches }));
}

export default async function handler(req, res) {
  const dateStrings = utcDays();
  const window = { from: dateStrings[0], to: dateStrings[dateStrings.length - 1] };
  const key = getBasketballApiKey();

  // Cache serveur 60 s par sport (demandé) : la clé inclut la fenêtre pour qu'un
  // changement de jour invalide l'entrée sans attendre l'expiration.
  const cacheKey = `basketball:${window.from}`;
  const cached = readRouteCache(cacheKey);
  if (cached) {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ ...cached, diagnostic: { ...cached.diagnostic, cached: true } });
  }

  const cascade = await runCascade([
    {
      name: "API-Basketball (v1.basketball.api-sports.io)",
      // Clé absente : ce n'est pas une panne, c'est une configuration — dit tel quel,
      // et la source suivante prend le relais au lieu de bloquer tout le sport.
      skip: key ? null : "Clé API absente (API_BASKETBALL_KEY ou API_FOOTBALL_KEY)",
      run: () => loadApiBasketball(dateStrings, key, window),
    },
    {
      name: "SportScore (secours)",
      run: () => loadSportScore("basketball"),
    },
  ]);

  const results = groupByCompetition(cascade.matches, window);

  let stale = false;
  let lastUpdated = null;
  if (await isQuotaExhausted("basketball")) {
    const cachedQuota = await readPersistentCache(`basketball:upcoming:${dateStrings[0]}`);
    if (cachedQuota) {
      stale = true;
      lastUpdated = new Date(cachedQuota.fetchedAt).toISOString();
    }
  }

  const primary = cascade.attempts[0] || {};
  const payload = {
    competitions: results,
    ...(stale ? { stale, lastUpdated } : {}),
    diagnostic: {
      source: cascade.attempts.map((a) => a.name).join(" → "),
      window,
      // Statut de la source qui a réellement servi la réponse (ou de la principale).
      upstreamStatus: cascade.attempts.find((a) => a.received > 0)?.httpStatus ?? primary.httpStatus ?? null,
      received: cascade.matches.length,
      daysQueried: dateStrings.length,
      sources: cascade.attempts,
      allSourcesFailed: cascade.allSourcesFailed,
      anySourceFailed: cascade.anySourceFailed,
      // Dernière erreur réelle enregistrée par le client (quota, abonnement, panne) —
      // voir lib/apiQuota.js#recordLastError, également affichée sur /admin.
      lastError: (await getLastError("basketball"))?.message || null,
      error: cascade.error,
    },
  };

  // Jamais de mise en cache d'une réponse dégradée : une panne de quelques secondes ne
  // doit pas figer le sport sur "aucun match" pendant une minute entière.
  if (!cascade.anySourceFailed) writeRouteCache(cacheKey, payload);

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  return res.status(200).json(payload);
}
