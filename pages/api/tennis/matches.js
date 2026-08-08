// Matchs de tennis — cascade de sources, côté serveur uniquement.
//
// Cette route répondait autrefois par un refus ÉCRIT EN DUR ("non disponibles avec
// cette source, plan gratuit"). C'était une décision du code : elle masquait des matchs
// pourtant disponibles ailleurs, et un écran vide ne doit JAMAIS venir d'une décision
// du code. Elle interroge désormais réellement ses sources.
//
// Cascade (voir lib/sourceCascade.js) :
//   1. SportScore — API publique, sans clé.
//   2. Live Tennis API (TENNIS_API_KEY) — plan gratuit : GET /matches?status=live.
// La seconde n'est appelée QUE si la première répond sans aucun match : c'est la règle
// « ne jamais conclure au vide avant d'avoir essayé la source secondaire ».
//
// Périmètre volontaire : cette route renvoie les matchs NON TERMINÉS de la fenêtre —
// à venir ET en cours. Les deux sources de tennis disponibles aujourd'hui sont
// centrées sur le direct (SportScore : « live and recent » ; Live Tennis API sur son
// plan gratuit : uniquement le direct) ; ne garder que les matchs pas encore commencés
// reviendrait à jeter tout ce qu'elles savent fournir. Le statut réel de chaque match
// est conservé tel quel, l'affichage décide ensuite quoi en faire.
import { matchesUrl, mapSportScoreMatch, sportScoreToBlumeMatch } from "../../../lib/sportScore";
import { getTennisApiKey, getLiveMatches } from "../../../lib/sports/tennis/provider";
import { mapLiveTennisMatch } from "../../../lib/sports/tennis/mapper";
import { runCascade } from "../../../lib/sourceCascade";
import { readRouteCache, writeRouteCache } from "../../../lib/routeCache";

const HORIZON_DAYS = 7;

// Fenêtre calculée en UTC (l'affichage la reconvertit dans le fuseau du visiteur).
function utcDayKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

async function loadSportScore() {
  const url = matchesUrl("tennis");
  const upstream = await fetch(url, { headers: { Accept: "application/json" } });
  const httpStatus = upstream.status;
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    console.warn(`[tennis/matches] SportScore ${url} → ${httpStatus} — ${body.slice(0, 300)}`);
    const err = new Error(`HTTP ${httpStatus}`);
    err.httpStatus = httpStatus;
    throw err;
  }

  const payload = await upstream.json();
  const list = Array.isArray(payload)
    ? payload
    : payload?.matches || payload?.data || payload?.results || payload?.items || [];
  console.log(`[tennis/matches] SportScore ${url} → ${httpStatus}, ${list.length} match(s) reçu(s)`);

  // Aucun filtre de tournoi, de catégorie ni de circuit : UTR, ITF, exhibitions,
  // juniors et vétérans passent exactement comme les Grands Chelems.
  return {
    httpStatus,
    matches: list
      .map((raw, i) => mapSportScoreMatch(raw, "tennis", i))
      .filter((m) => m.status !== "finished")
      .map(sportScoreToBlumeMatch),
  };
}

async function loadLiveTennisApi(key) {
  const raw = await getLiveMatches(key);
  console.log(`[tennis/matches] Live Tennis API → ${raw.length} match(s) en direct (source de secours)`);
  return {
    httpStatus: 200,
    matches: raw.map((m) => mapLiveTennisMatch(m, null)),
  };
}

export default async function handler(req, res) {
  const now = Date.now();
  const window = { from: utcDayKey(now), to: utcDayKey(now + HORIZON_DAYS * 24 * 3600000) };

  // Cache serveur 60 s par sport (demandé).
  const cacheKey = `tennis:${window.from}`;
  const cached = readRouteCache(cacheKey);
  if (cached) {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ ...cached, diagnostic: { ...cached.diagnostic, cached: true } });
  }

  const key = getTennisApiKey();
  const cascade = await runCascade([
    { name: "SportScore", run: loadSportScore },
    {
      name: "Live Tennis API (secours)",
      skip: key ? null : "Clé API absente (TENNIS_API_KEY)",
      run: () => loadLiveTennisApi(key),
    },
  ]);

  // Fenêtre de dates, appliquée après la cascade pour que le diagnostic distingue
  // « la source n'a rien » de « la source a des matchs, mais hors fenêtre ».
  const fromMs = Date.parse(`${window.from}T00:00:00Z`);
  const toMs = Date.parse(`${window.to}T23:59:59Z`);
  const inWindow = cascade.matches.filter((m) => {
    if (!m.homeTeam?.name || !m.awayTeam?.name || !m.utcDate) return false;
    const t = Date.parse(m.utcDate);
    return Number.isFinite(t) && t >= fromMs && t <= toMs;
  });

  const byComp = new Map();
  for (const m of inWindow) {
    const name = m.competition?.name || "Tournoi non communiqué";
    if (!byComp.has(name)) byComp.set(name, { code: m.competition?.code || name, name, area: "", matches: [] });
    byComp.get(name).matches.push({ ...m, pronostic: { available: false } });
  }

  const payload = {
    competitions: [...byComp.values()].sort((a, b) => a.name.localeCompare(b.name)),
    diagnostic: {
      source: cascade.attempts.map((a) => a.name).join(" → "),
      window,
      upstreamStatus: cascade.attempts.find((a) => a.received > 0)?.httpStatus ?? cascade.attempts[0]?.httpStatus ?? null,
      received: cascade.matches.length,
      inWindow: inWindow.length,
      sources: cascade.attempts,
      allSourcesFailed: cascade.allSourcesFailed,
      anySourceFailed: cascade.anySourceFailed,
      error: cascade.error,
    },
  };

  if (!cascade.anySourceFailed) writeRouteCache(cacheKey, payload);

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  return res.status(200).json(payload);
}
