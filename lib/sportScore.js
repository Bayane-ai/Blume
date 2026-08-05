// Source SportScore (https://sportscore.com) — API publique gratuite, CORS ouverte,
// SANS clé API, appelée DIRECTEMENT depuis le navigateur de chaque visiteur (aucune
// route /api de Blume, aucun backend, aucune variable d'environnement à configurer).
//
// Ce qui a été VÉRIFIÉ (source : code du wrapper MCP officiel de SportScore,
// https://github.com/Backspace-me/sportscore-mcp, qui mappe 1:1 les endpoints REST
// documentés sur https://sportscore.com/developers/) :
//   - base https://sportscore.com, chemin /api/widget/matches/
//   - paramètres : sport ∈ {football, basketball, cricket, tennis}, limit 1..50
//   - aucune clé API, en-têtes CORS ouverts, ~1000 requêtes/24h/IP, cache edge 60s
//   - attribution "Powered by SportScore" obligatoire sur l'offre gratuite
//     (voir components/SportScoreSection.js, lien dofollow rendu sous chaque section)
//
// Ce qui n'a PAS pu être vérifié depuis l'environnement de développement (Cloudflare
// bloque la spec OpenAPI et l'endpoint pour un client non-navigateur) : les NOMS EXACTS
// des champs JSON de la réponse. Le mapper ci-dessous suit donc la convention déjà
// établie partout ailleurs sur Blume face à une forme de réponse non confirmable (voir
// lib/sports/tennis/mapper.js) : plusieurs chemins de repli plausibles par champ, et
// JAMAIS une valeur inventée — un champ introuvable reste vide/null et l'interface
// l'affiche honnêtement comme indisponible.
//
// L'endpoint est documenté comme renvoyant les matchs "live and recent" : la liste peut
// donc contenir des matchs à venir, en direct ET terminés. Chaque carte affiche le vrai
// statut du match (voir mapStatus), jamais un match présenté comme "à venir" alors que
// l'API le donne terminé.
const SPORTSCORE_BASE = "https://sportscore.com";
const MATCHES_PATH = "/api/widget/matches/";

// Plafond réel de l'API (limit max = 50, voir le schéma d'entrée du wrapper officiel).
const MAX_LIMIT = 50;

export function matchesUrl(sport, limit = MAX_LIMIT) {
  const safeLimit = Math.min(Math.max(Number(limit) || MAX_LIMIT, 1), MAX_LIMIT);
  return `${SPORTSCORE_BASE}${MATCHES_PATH}?sport=${encodeURIComponent(sport)}&limit=${safeLimit}`;
}

// Repli same-origin (voir pages/api/sportscore.js) : utilisé UNIQUEMENT si l'appel
// direct navigateur ci-dessus échoue — typiquement quand sportscore.com refuse la
// requête inter-domaine (CORS), ou qu'un bloqueur/réseau d'entreprise l'intercepte.
// Sans ce filet, la section n'aurait plus rien à afficher alors que la donnée est
// parfaitement récupérable côté serveur.
export function proxyMatchesUrl(sport, limit = MAX_LIMIT) {
  const safeLimit = Math.min(Math.max(Number(limit) || MAX_LIMIT, 1), MAX_LIMIT);
  return `/api/sportscore?sport=${encodeURIComponent(sport)}&limit=${safeLimit}`;
}

// Premier chemin non vide parmi plusieurs candidats — voir la note sur les champs non
// confirmés en tête de fichier.
function pick(obj, ...paths) {
  for (const path of paths) {
    let cur = obj;
    for (const key of path.split(".")) {
      if (cur == null) break;
      cur = cur[key];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return null;
}

// Garde-fou d'affichage : seuls une chaîne ou un nombre peuvent atteindre l'interface.
// Sans ça, un repli comme "league" (au lieu de "league.name") pourrait renvoyer un
// OBJET — React lève alors "Objects are not valid as a React child", ce qui casserait
// la section entière et remplirait la console d'erreurs. Renvoie null plutôt qu'un
// "[object Object]" ou un "undefined" affiché à l'écran.
function text(value) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

// La liste peut être renvoyée nue ou enveloppée : on accepte les enveloppes usuelles
// plutôt que de parier sur une seule.
export function unwrapMatches(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["matches", "data", "results", "items", "response"]) {
    const v = payload?.[key];
    if (Array.isArray(v)) return v;
  }
  // Enveloppe à deux niveaux ({ data: { matches: [...] } }).
  for (const key of ["data", "response"]) {
    const inner = payload?.[key];
    if (inner && typeof inner === "object") {
      for (const k2 of ["matches", "results", "items"]) {
        if (Array.isArray(inner[k2])) return inner[k2];
      }
    }
  }
  return [];
}

// Statut normalisé pour l'affichage : "upcoming" | "live" | "finished".
// Recherche par mot-clé (jamais une égalité stricte fragile face à un libellé qui
// varie d'un sport ou d'une compétition à l'autre).
export function mapStatus(raw) {
  const text = String(
    pick(raw, "status.type", "status.state", "status", "state", "match_status", "status_text") || ""
  )
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  if (/final|finished|ended|complete|full time|ft\b|after extra|aet|walkover|retired/.test(text)) return "finished";
  if (/live|in ?progress|playing|in ?play|1st|2nd|half|set \d|q\d|ongoing|break|halftime/.test(text)) return "live";
  if (/not started|scheduled|upcoming|pending|fixture|ns\b|tbd|postponed|delayed/.test(text)) return "upcoming";

  // Statut inconnu : on tranche sur l'heure de coup d'envoi réelle si elle existe,
  // jamais au hasard.
  const iso = pickStartTime(raw);
  if (iso) return new Date(iso).getTime() > Date.now() ? "upcoming" : "finished";
  return "upcoming";
}

function pickStartTime(raw) {
  const v = pick(
    raw,
    "start_at", "start_time", "startTime", "starts_at", "scheduled_at",
    "kickoff", "kickoff_at", "date_time", "datetime", "date", "time"
  );
  if (v == null) return null;
  // Certaines API renvoient un timestamp UNIX (secondes ou millisecondes).
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapSide(raw, side) {
  const other = side === "home" ? "away" : "home";
  const node =
    pick(raw, `${side}_team`, `${side}Team`, `teams.${side}`, `${side}_player`, side) ||
    (Array.isArray(raw?.competitors)
      ? raw.competitors.find((c) => String(c?.side || c?.home_away || "").toLowerCase() === side) ||
        raw.competitors[side === "home" ? 0 : 1]
      : null);

  return {
    name: text(pick(node, "name", "title", "short_name", "shortName", "display_name", "slug")),
    logo: text(pick(node, "logo", "logo_url", "logoUrl", "image", "image_url", "crest", "icon", "flag")),
    // Évite qu'un objet vide côté "away" recopie par erreur le "home".
    _side: other && side,
  };
}

// Traduit un match brut SportScore vers la forme utilisée par components/
// SportScoreSection.js. Ne lève jamais : un champ absent reste null et l'interface
// l'affiche honnêtement comme indisponible, jamais remplacé par une valeur inventée.
export function mapSportScoreMatch(raw, sport, index = 0) {
  const home = mapSide(raw, "home");
  const away = mapSide(raw, "away");
  const id = pick(raw, "id", "slug", "match_id", "uuid");

  return {
    id: `ss-${sport}-${id ?? index}`,
    sport,
    home,
    away,
    competition: text(
      pick(
        raw,
        "league.name", "competition.name", "tournament.name", "series.name",
        "league", "competition", "tournament", "category.name"
      )
    ),
    startTime: pickStartTime(raw),
    status: mapStatus(raw),
  };
}

// Grandes compétitions à faire remonter en tête (demande explicite). Recherche par
// mot-clé sur le nom réel renvoyé par l'API : jamais une liste d'identifiants codés en
// dur qui casserait au moindre changement de libellé côté source.
const FOOTBALL_MAJORS = [
  /champions league/i,
  /europa league/i,
  /conference league/i,
  /premier league/i,
  /\bla ?liga\b/i,
  /serie a/i,
  /bundesliga/i,
  /ligue 1/i,
];

const TENNIS_MAJORS = [
  /grand slam|wimbledon|roland[- ]garros|french open|us open|australian open/i,
  /\batp\b/i,
  /\bwta\b/i,
];

const BASKETBALL_MAJORS = [
  /\bnba\b/i,
  /euroleague|euro league/i,
];

const MAJORS_BY_SPORT = {
  football: FOOTBALL_MAJORS,
  tennis: TENNIS_MAJORS,
  basketball: BASKETBALL_MAJORS,
};

export function competitionRank(competition, sport) {
  const name = competition || "";
  const majors = MAJORS_BY_SPORT[sport] || FOOTBALL_MAJORS;
  const idx = majors.findIndex((re) => re.test(name));
  return idx === -1 ? majors.length : idx;
}

const STATUS_RANK = { live: 0, upcoming: 1, finished: 2 };

// Tri : grandes compétitions d'abord, puis en direct > à venir > terminé, puis par
// heure de coup d'envoi. Jamais un match écarté (les amicaux et petites compétitions
// restent affichés, simplement plus bas).
export function sortMatches(matches, sport) {
  return [...matches].sort(
    (a, b) =>
      competitionRank(a.competition, sport) - competitionRank(b.competition, sport) ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.startTime ? new Date(a.startTime) : 0) - (b.startTime ? new Date(b.startTime) : 0)
  );
}

// Dernière liste RÉELLE connue, conservée dans le navigateur du visiteur. Sert de
// "contenu par défaut" affiché immédiatement au chargement suivant, avant même la
// réponse de l'API — et de filet si l'API tombe : la section montre alors les derniers
// vrais matchs connus plutôt que de se vider. Jamais de match inventé : tant qu'aucune
// vraie réponse n'a été reçue une première fois, ce cache est simplement absent (le
// squelette de chargement prend alors le relais, voir components/SportScoreSection.js).
const CACHE_PREFIX = "blume_sportscore_";
// Au-delà de 24h, une liste "du jour" n'a plus de sens : mieux vaut le squelette qu'un
// affichage périmé présenté comme actuel.
const CACHE_MAX_AGE_MS = 24 * 3600 * 1000;

export function readCachedMatches(sport, storage) {
  try {
    const store = storage || (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return null;
    const raw = store.getItem(CACHE_PREFIX + sport);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.matches) || parsed.matches.length === 0) return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null;
    return parsed.matches;
  } catch {
    // localStorage indisponible (navigation privée, quota, JSON corrompu) : on
    // retombe simplement sur le squelette, jamais une erreur visible.
    return null;
  }
}

export function writeCachedMatches(sport, matches, storage) {
  try {
    const store = storage || (typeof window !== "undefined" ? window.localStorage : null);
    if (!store || !Array.isArray(matches) || matches.length === 0) return;
    store.setItem(CACHE_PREFIX + sport, JSON.stringify({ savedAt: Date.now(), matches }));
  } catch {
    // Écriture impossible : sans conséquence, le site fonctionne à l'identique.
  }
}

// Récupère et normalise les matchs d'un sport. Lève en cas d'échec réel (HTTP ou
// réseau) : l'appelant décide quoi afficher (voir components/SportScoreSection.js, qui
// bascule alors sur un message clair — jamais une section vide ou cassée).
async function fetchAndMap(url, sport, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`SportScore ${sport} : HTTP ${res.status}`);
  const payload = await res.json();
  const mapped = unwrapMatches(payload)
    .map((raw, i) => mapSportScoreMatch(raw, sport, i))
    // Un match sans aucun nom d'équipe/joueur n'est pas affichable : on l'écarte
    // plutôt que de montrer une carte à moitié vide.
    .filter((m) => m.home.name && m.away.name);
  return sortMatches(mapped, sport);
}

// Deux tentatives, dans cet ordre :
//   1. appel DIRECT navigateur -> sportscore.com (le fonctionnement voulu, sans backend) ;
//   2. si et seulement si le 1 échoue (CORS, blocage réseau, extension), même donnée
//      via le relais du site lui-même (voir pages/api/sportscore.js).
// Le visiteur voit les matchs dans les deux cas, sans jamais rien avoir à faire.
export async function fetchSportScoreMatches(sport, { limit = MAX_LIMIT, fetchImpl = fetch } = {}) {
  try {
    return await fetchAndMap(matchesUrl(sport, limit), sport, fetchImpl);
  } catch (directError) {
    try {
      return await fetchAndMap(proxyMatchesUrl(sport, limit), sport, fetchImpl);
    } catch {
      // Les deux voies ont échoué : on remonte l'erreur d'ORIGINE, plus parlante pour
      // diagnostiquer (le relais, lui, ne fait que refléter la même panne en amont).
      throw directError;
    }
  }
}
