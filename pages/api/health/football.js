// Diagnostic temps réel de CHAQUE source de données utilisée par le site (voir PROMPT :
// "écran vide généralisé, diagnostic automatique") — appelle réellement chaque API (jamais
// une simple lecture de cache) pour répondre sans ambiguïté à "la clé est-elle présente ?"
// et "que répond l'API EN CE MOMENT ?" (code HTTP exact, corps de l'erreur, quota restant).
//
// Gardée derrière l'authentification admin (même garde que /admin) : chaque appel de
// cette route déclenche de VRAIS appels réseau vers les 4 sources — jamais quelque chose
// à laisser un visiteur ordinaire déclencher à volonté (voir PROMPT, principe déjà établi
// partout ailleurs sur ce site : "aucun appel API déclenché par une visite utilisateur").
//
// Ne doit JAMAIS planter : chaque source est vérifiée indépendamment (Promise.allSettled),
// et chaque vérification a son propre try/catch — une source injoignable ou mal configurée
// ne doit jamais empêcher de connaître l'état des trois autres.
import { getSession } from "../../../lib/session";
import { isAdmin } from "../../../lib/auth/admin";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

async function checkFootballData() {
  const name = "football-data.org";
  const keyEnvVar = "FOOTBALL_DATA_TOKEN";
  const checkedAt = new Date().toISOString();
  const token = process.env.FOOTBALL_DATA_TOKEN || null;
  if (!token) {
    return { name, keyEnvVar, keyPresent: false, ok: false, httpStatus: null, errorBody: null, quota: null, checkedAt };
  }
  try {
    // Endpoint le plus léger disponible côté football-data.org (pas de /status dédié
    // sur cette API, contrairement à API-SPORTS ci-dessous) : la liste des compétitions,
    // rapide et peu coûteuse en quota.
    const r = await fetch(`${FOOTBALL_DATA_BASE}/competitions`, { headers: { "X-Auth-Token": token } });
    const remainingMinute = r.headers.get("x-requests-available-minute");
    let errorBody = null;
    if (!r.ok) {
      errorBody = (typeof r.text === "function" ? await r.text().catch(() => "") : "").slice(0, 500);
    }
    return {
      name,
      keyEnvVar,
      keyPresent: true,
      ok: r.ok,
      httpStatus: r.status,
      errorBody,
      quota: remainingMinute != null ? { remainingThisMinute: Number(remainingMinute) } : null,
      checkedAt,
    };
  } catch (e) {
    return { name, keyEnvVar, keyPresent: true, ok: false, httpStatus: null, errorBody: e.message, quota: null, checkedAt };
  }
}

// API-SPORTS (football/basket/tennis) expose un vrai /status renvoyant directement
// l'abonnement (actif ou non, plan) et le quota du jour (current / limit_day) — la
// réponse la plus fiable possible à "quota épuisé ou pas".
async function checkApiSportsStatus({ name, base, keyEnvVar, key }) {
  const checkedAt = new Date().toISOString();
  if (!key) {
    return { name, keyEnvVar, keyPresent: false, ok: false, httpStatus: null, errorBody: null, quota: null, checkedAt };
  }
  try {
    const r = await fetch(`${base}/status`, { headers: { "x-apisports-key": key } });
    let bodyJson = null;
    try {
      bodyJson = await r.json();
    } catch {
      // Corps non-JSON (page d'erreur HTML, etc.) : pas bloquant, on garde httpStatus.
    }
    if (!r.ok) {
      return {
        name, keyEnvVar, keyPresent: true, ok: false, httpStatus: r.status,
        errorBody: JSON.stringify(bodyJson || {}).slice(0, 500), quota: null, checkedAt,
      };
    }
    const account = bodyJson?.response;
    const quota = account
      ? {
          plan: account.subscription?.plan ?? null,
          subscriptionActive: account.subscription?.active ?? null,
          current: account.requests?.current ?? null,
          limitDay: account.requests?.limit_day ?? null,
        }
      : null;
    return { name, keyEnvVar, keyPresent: true, ok: true, httpStatus: r.status, errorBody: null, quota, checkedAt };
  } catch (e) {
    return { name, keyEnvVar, keyPresent: true, ok: false, httpStatus: null, errorBody: e.message, quota: null, checkedAt };
  }
}

function settledToResult(settled, name) {
  if (settled.status === "fulfilled") return settled.value;
  return {
    name,
    keyEnvVar: null,
    keyPresent: null,
    ok: false,
    httpStatus: null,
    errorBody: settled.reason?.message || "Erreur inattendue lors du diagnostic",
    quota: null,
    checkedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!isAdmin(session)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Non autorisé");
  }

  res.setHeader("Cache-Control", "no-store");

  const apiFootballKey = process.env.API_FOOTBALL_KEY || null;
  const apiBasketballKey = process.env.API_BASKETBALL_KEY || apiFootballKey;
  const apiTennisKey = process.env.API_TENNIS_KEY || apiFootballKey;

  const settled = await Promise.allSettled([
    checkFootballData(),
    checkApiSportsStatus({
      name: "API-Football", base: "https://v3.football.api-sports.io",
      keyEnvVar: "API_FOOTBALL_KEY", key: apiFootballKey,
    }),
    checkApiSportsStatus({
      name: "API-Basketball", base: "https://v1.basketball.api-sports.io",
      keyEnvVar: "API_BASKETBALL_KEY (ou API_FOOTBALL_KEY en repli)", key: apiBasketballKey,
    }),
    checkApiSportsStatus({
      name: "API-Tennis", base: "https://v1.tennis.api-sports.io",
      keyEnvVar: "API_TENNIS_KEY (ou API_FOOTBALL_KEY en repli)", key: apiTennisKey,
    }),
  ]);

  const names = ["football-data.org", "API-Football", "API-Basketball", "API-Tennis"];
  return res.status(200).json({
    checkedAt: new Date().toISOString(),
    sources: settled.map((s, i) => settledToResult(s, names[i])),
  });
}
