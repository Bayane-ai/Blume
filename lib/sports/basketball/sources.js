// Chaîne de sources BASKET — côté serveur uniquement.
//
// Ordre d'interrogation, passage automatique à la suivante si la précédente échoue OU
// renvoie 0 match :
//   A — API-Basketball (API-SPORTS)  : toutes ligues, tous pays, jour par jour
//   B — SportScore                   : publique, sans clé
//   C — balldontlie                  : NBA uniquement (voir la limite ci-dessous)
//
// Aucune liste blanche, aucun filtre de ligue, de pays ou de compétition. Timeout de
// 10 s sur CHAQUE appel externe. Aucune exception ne remonte : la route répond
// toujours 200.
//
// ── Contrat balldontlie, VÉRIFIÉ, jamais deviné ────────────────────────────────────
// Lu dans le SDK OFFICIEL du fournisseur (npm `@balldontlie/sdk`) :
//   • base           https://api.balldontlie.io
//   • chemin         /nba/v1/games
//   • authentification en-tête `Authorization: <clé>` — la clé BRUTE, sans « Bearer »
//   • paramètres     start_date, end_date (AAAA-MM-JJ), per_page, cursor
//   • pagination     `meta.next_cursor` ; on boucle tant qu'il est renseigné
//   • forme d'un jeu { id, date, status, home_team: { full_name }, visitor_team: {…} }
//
// ⚠️ LIMITE ASSUMÉE, dite ici plutôt que découverte plus tard : le SDK officiel
// n'expose que NBA, MLB, NFL et EPL — **il n'y a pas de WNBA**. balldontlie ne peut
// donc pas couvrir la WNBA, les ligues d'été ni les championnats nationaux, et ne
// renvoie rien pendant l'intersaison NBA (juillet-septembre). C'est un vrai troisième
// fournisseur, indépendant des deux autres, mais il ne remplace pas API-Basketball
// pour une couverture mondiale : il sert de filet en saison NBA.
import { matchesUrl, mapSportScoreMatch, sportScoreToBlumeMatch } from "../../sportScore";

const BDL_BASE = process.env.BALLDONTLIE_BASE_URL || "https://api.balldontlie.io";
const TIMEOUT_MS = 10 * 1000;
const PER_PAGE = 100;
const MAX_PAGES = 20;

export function getBalldontlieKey() {
  return process.env.BALLDONTLIE_API_KEY || null;
}

// Timeout explicite sur chaque appel externe (demandé). Sans lui, une source lente
// retarde toute la chaîne et peut faire expirer la fonction serverless entière.
async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const corps = await res.text().catch(() => "");
    console.log(`[basket] ${url} → HTTP ${res.status} — ${corps.slice(0, 300)}`);
    const err = new Error(`HTTP ${res.status}`);
    err.httpCode = res.status;
    throw err;
  }
  return { payload: await res.json(), httpCode: res.status };
}

// ── Source B — SportScore ──────────────────────────────────────────────────────────
// Son endpoint public ne prend QUE `sport` et `limit` (max 50) : ni date, ni
// pagination — vérifié sur le wrapper officiel du fournisseur, qui le décrit comme
// « live and recent matches ». Il ne peut donc pas couvrir une fenêtre J → J+7, et
// c'est précisément pour cela qu'il n'est pas la source principale.
export async function sourceSportScore() {
  if (process.env.FORCE_SPORTSCORE_FAIL === "1") {
    throw new Error("FORCE_SPORTSCORE_FAIL=1 (panne simulée)");
  }
  const url = matchesUrl("basketball");
  const { payload, httpCode } = await fetchJson(url, { headers: { Accept: "application/json" } });
  const liste = Array.isArray(payload)
    ? payload
    : payload?.matches || payload?.data || payload?.results || payload?.items || [];

  console.log(`[basket] SportScore ${url} → ${httpCode}, ${liste.length} match(s) reçu(s)`);
  return {
    httpCode,
    matches: liste
      .map((brut, i) => mapSportScoreMatch(brut, "basketball", i))
      .filter((m) => m.status !== "finished")
      .map(sportScoreToBlumeMatch),
  };
}

// ── Source C — balldontlie (NBA) ───────────────────────────────────────────────────
// Fenêtre passée en start_date/end_date, pagination suivie via meta.next_cursor.
export async function sourceBalldontlie(key, { from, to }) {
  const matches = [];
  let cursor = null;
  let httpCode = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const q = new URLSearchParams({ start_date: from, end_date: to, per_page: String(PER_PAGE) });
    if (cursor != null) q.set("cursor", String(cursor));
    const out = await fetchJson(`${BDL_BASE}/nba/v1/games?${q}`, {
      // Clé BRUTE, sans « Bearer » : c'est ce que fait le SDK officiel.
      headers: { Accept: "application/json", Authorization: key },
    });
    httpCode = out.httpCode;

    const lot = Array.isArray(out.payload?.data) ? out.payload.data : [];
    for (const g of lot) {
      const domicile = g?.home_team?.full_name;
      const exterieur = g?.visitor_team?.full_name;
      if (!domicile || !exterieur || !g?.date) continue;
      const termine = /final/i.test(String(g.status || ""));
      if (termine) continue;
      matches.push({
        id: `bdl-${g.id}`,
        status: /progress|qtr|half/i.test(String(g.status || "")) ? "IN_PLAY" : "SCHEDULED",
        // `date` est une date de journée ; `status` porte l'heure quand elle est connue.
        utcDate: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? `${g.date}T00:00:00.000Z` : g.date,
        competition: { code: "NBA", name: "NBA", area: "USA" },
        homeTeam: { id: "", name: domicile, crest: "" },
        awayTeam: { id: "", name: exterieur, crest: "" },
        score: { fullTime: { home: null, away: null } },
      });
    }

    cursor = out.payload?.meta?.next_cursor ?? null;
    if (!cursor || lot.length === 0) break;
  }

  console.log(`[basket] balldontlie /nba/v1/games ${from} → ${to} : ${matches.length} match(s)`);
  return { matches, httpCode };
}
