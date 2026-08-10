// Chaîne de sources TENNIS (bloc 2, point 1) — côté serveur UNIQUEMENT.
//
// Ordre d'interrogation, passage automatique à la suivante si la précédente échoue OU
// renvoie 0 match :
//   A — SportScore                       (publique, sans clé)
//   B — Live Tennis API  GET /fixtures   (clé LIVE_TENNIS_API_KEY)
//   C — Live Tennis API  GET /matches?status=upcoming
//
// Aucun filtre de tournoi, de circuit ni de pays : ATP, WTA, ITF, UTR, Challenger,
// juniors et exhibitions passent tous. Seule la fenêtre de dates écarte.
//
// ── Contrat Live Tennis API, VÉRIFIÉ, jamais deviné ────────────────────────────────
// Lu dans le client OFFICIEL publié par le fournisseur (npm `livetennisapi@1.4.1`,
// https://github.com/livetennisapi/livetennisapi-js), pas dans une page de blog :
//   • base           https://api.livetennisapi.com/api/public/v1
//   • authentifation en-tête `Authorization: Bearer <clé>`
//   • GET /fixtures            « Upcoming scheduled fixtures, earliest first »
//                              paramètres : tour?, limit?, offset?
//   • GET /matches             paramètres : status?, tour?, player?, country?,
//                              from?, to?, limit?, offset?
//                              status ∈ 'live' | 'upcoming' | 'completed'
//   • réponse      { data: [...], meta: { limit, offset, count, total, has_more } }
//     La doc du client est explicite : pour paginer, lire `meta.has_more`, JAMAIS
//     comparer `count` à `limit` — un filtre peut rendre une page courte sans que ce
//     soit la fin des données.
//   • `listFixtures`, `listMatches` et `listTournaments` sont au tier **FREE**.
//
// C'est le point important de ce bloc : le code affirmait jusqu'ici que « le plan
// gratuit n'expose pas de calendrier ». C'était faux, et c'est la raison pour laquelle
// l'onglet tennis restait vide. /fixtures est exactement le calendrier manquant.
//
// Forme d'un Fixture (interface Fixture du client officiel) :
//   { id, event_date, start_time, player1_id, player2_id, tour, tournament, round,
//     round_code, surface, player1_name, player2_name, status }
//   `start_time` est nul tant que l'ordre du jour n'a pas fixé l'heure — c'est un état
//   réel, pas une donnée manquante.
import { matchesUrl, mapSportScoreMatch } from "../../sportScore";
import { normaliserMatch } from "../../normalizedMatch";

// Base surchargeable par LIVETENNISAPI_BASE_URL — c'est la variable que lit le client
// OFFICIEL du fournisseur, pas une invention pour les tests : elle sert aussi bien à
// pointer un bac à sable qu'à valider la chaîne sans dépendre du réseau.
const LTA_BASE = process.env.LIVETENNISAPI_BASE_URL || "https://api.livetennisapi.com/api/public/v1";
const TIMEOUT_MS = 8000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // garde-fou : jamais une boucle infinie sur un `has_more` collé à true

// La variable demandée est LIVE_TENNIS_API_KEY. LIVETENNISAPI_KEY est celle que lit le
// client officiel, TENNIS_API_KEY celle déjà posée sur ce projet : les trois sont
// acceptées pour qu'aucune configuration existante ne casse.
export function getLiveTennisKey() {
  return (
    process.env.LIVE_TENNIS_API_KEY ||
    process.env.LIVETENNISAPI_KEY ||
    process.env.TENNIS_API_KEY ||
    null
  );
}

// Timeout de 8 s par source (demandé) : une source lente ne doit jamais retarder la
// suivante, ni la réponse au visiteur.
async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const httpCode = res.status;
  if (!res.ok) {
    const corps = await res.text().catch(() => "");
    console.log(`[tennis] ${url} → HTTP ${httpCode} — ${corps.slice(0, 300)}`);
    const err = new Error(`HTTP ${httpCode}`);
    err.httpCode = httpCode;
    throw err;
  }
  return { payload: await res.json(), httpCode };
}

function statutTennis(brut) {
  const s = String(brut || "").toLowerCase();
  if (s.includes("live") || s.includes("progress") || s.includes("play")) return "en_cours";
  if (s.includes("complet") || s.includes("finish") || s.includes("ended")) return "termine";
  return "a_venir";
}

// ── Source A — SportScore ──────────────────────────────────────────────────────────
// Endpoint public sans clé. Il ne prend que `sport` et `limit` (vérifié sur le
// wrapper officiel) : ni date, ni pagination. C'est justement pourquoi il ne peut pas
// porter seul un calendrier, et pourquoi les sources B et C existent.
export async function sourceSportScore() {
  // Interrupteur de test (demandé) : permet de prouver que la source suivante prend
  // réellement le relais, sans avoir à débrancher quoi que ce soit.
  if (process.env.FORCE_SPORTSCORE_FAIL === "1") {
    throw new Error("FORCE_SPORTSCORE_FAIL=1 (panne simulée)");
  }

  const url = matchesUrl("tennis");
  const { payload, httpCode } = await fetchJson(url, { headers: { Accept: "application/json" } });
  const liste = Array.isArray(payload)
    ? payload
    : payload?.matches || payload?.data || payload?.results || payload?.items || [];

  const matchs = liste
    .map((brut, i) => mapSportScoreMatch(brut, "tennis", i))
    .map((m) =>
      normaliserMatch({
        id: m.id,
        sport: "tennis",
        tournoi: m.competition,
        pays: null,
        categorie: null,
        joueur1: m.home?.name,
        joueur2: m.away?.name,
        debutUtc: m.startTime,
        statut: m.status === "live" ? "en_cours" : m.status === "finished" ? "termine" : "a_venir",
        source: "SportScore",
      })
    );
  return { matchs, httpCode };
}

// Pagination réelle : on suit `meta.has_more`, exactement comme le prescrit la doc du
// client officiel — et on s'arrête aussi sur une page vide, pour ne jamais boucler.
async function ltaPaginer(chemin, key, mapper) {
  const matchs = [];
  let offset = 0;
  let httpCode = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const sep = chemin.includes("?") ? "&" : "?";
    const url = `${LTA_BASE}${chemin}${sep}limit=${PAGE_SIZE}&offset=${offset}`;
    const out = await fetchJson(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    });
    httpCode = out.httpCode;

    const lot = Array.isArray(out.payload?.data) ? out.payload.data : [];
    matchs.push(...lot.map(mapper));

    const meta = out.payload?.meta || {};
    if (!meta.has_more || lot.length === 0) break;
    offset += lot.length || PAGE_SIZE;
  }

  console.log(`[tennis] Live Tennis API ${chemin} : ${matchs.length} entrée(s) sur ${MAX_PAGES} page(s) max`);
  return { matchs, httpCode };
}

// ── Source B — Live Tennis API, GET /fixtures ──────────────────────────────────────
export async function sourceLiveTennisFixtures(key) {
  return ltaPaginer("/fixtures", key, (f) =>
    normaliserMatch({
      id: f?.id != null ? `lta-fx-${f.id}` : null,
      sport: "tennis",
      tournoi: f?.tournament,
      pays: null, // /fixtures ne porte pas le pays ; getTournament l'a, mais coûterait un appel par tournoi
      // `surface` et `round` sont ce que cette source dit de la catégorie du match —
      // jamais un circuit deviné à partir du nom du tournoi.
      categorie: f?.tour || f?.round_code || f?.round || null,
      joueur1: f?.player1_name,
      joueur2: f?.player2_name,
      // start_time est nul tant que l'ordre du jour n'est pas publié : on retombe alors
      // sur la date de journée, qui reste une information vraie.
      debutUtc: f?.start_time || f?.event_date || null,
      statut: statutTennis(f?.status || "upcoming"),
      source: "Live Tennis API /fixtures",
    })
  );
}

// ── Source C — Live Tennis API, GET /matches?status=upcoming ───────────────────────
// Endpoint DIFFÉRENT, alimenté par le flux de matchs et non par l'ordre du jour : il
// contient des rencontres que /fixtures n'a pas encore, et inversement. Il protège
// donc réellement contre un /fixtures vide.
// Limite assumée, dite ici plutôt que passée sous silence : B et C partagent le même
// fournisseur. Elles ne protègent pas d'une panne totale de Live Tennis API — il
// faudrait pour cela un troisième fournisseur indépendant (voir le rapport).
export async function sourceLiveTennisUpcoming(key) {
  return ltaPaginer("/matches?status=upcoming", key, (m) =>
    normaliserMatch({
      id: m?.id != null ? `lta-m-${m.id}` : null,
      sport: "tennis",
      tournoi: m?.tournament,
      pays: null,
      categorie: m?.tour || m?.round_code || m?.round || null,
      joueur1: m?.players?.p1?.name,
      joueur2: m?.players?.p2?.name,
      debutUtc: m?.scheduled_time || null,
      statut: statutTennis(m?.status || "upcoming"),
      source: "Live Tennis API /matches",
    })
  );
}

// Chaîne complète, dans l'ordre. Une source sans clé n'est pas une panne : elle est
// déclarée « non configurée » et la suivante prend le relais (demandé).
export function chaineTennis() {
  const key = getLiveTennisKey();
  const nonConfiguree = key
    ? null
    : "non configurée (LIVE_TENNIS_API_KEY absente)";

  return [
    { nom: "SportScore", run: sourceSportScore },
    { nom: "Live Tennis API /fixtures", skip: nonConfiguree, run: () => sourceLiveTennisFixtures(key) },
    { nom: "Live Tennis API /matches?status=upcoming", skip: nonConfiguree, run: () => sourceLiveTennisUpcoming(key) },
  ];
}
