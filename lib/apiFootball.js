// Source des ÉVÉNEMENTS live (buts, cartons, remplacements) d'un match : football-data.org
// (utilisé pour tout le reste du site — classements, matchs à venir, score/minute en
// direct) ne fournit pas de fil d'événements minute par minute, quel que soit le plan —
// voir pages/api/analyze.js, qui expliquait déjà pourquoi `events` valait toujours null.
// API-Football (api-football.com / API-SPORTS) comble ce manque précis :
//   - GET /fixtures?live=all       → TOUS les matchs en direct dans le monde, sans filtre
//                                     de compétition ni de pays, avec score et minute.
//   - GET /fixtures/events?fixture=ID → le fil d'événements réel de CE match.
// Nécessite la variable d'environnement API_FOOTBALL_KEY (clé API-SPORTS, plan gratuit
// ou payant). Sans clé, toutes les fonctions ci-dessous renvoient simplement une absence
// de données (jamais d'erreur qui casserait le reste du site, jamais de donnée inventée).
const BASE = "https://v3.football.api-sports.io";

// Le plan gratuit API-Football est limité à 100 requêtes/JOUR (pas par minute comme
// football-data.org) : un cache nettement plus long que les autres caches du site est
// indispensable pour ne pas épuiser ce quota en quelques minutes dès qu'un match est
// suivi en direct. 30s reste un rafraîchissement "automatique" au sens de la demande
// (un but apparaît avec au plus 30s de retard) tout en gardant l'usage soutenable —
// voir le calcul de budget quotidien dans le message de livraison de cette fonctionnalité.
const LIVE_LIST_TTL_MS = 30000;
const EVENTS_TTL_MS = 30000;

let liveListCache = null; // { fixtures, fetchedAt }
let liveListInFlight = null;

const eventsCache = new Map(); // fixtureId -> { events, fetchedAt }
const eventsInFlight = new Map();

async function apiFootballFetch(path, key) {
  const r = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": key } });
  if (!r.ok) throw new Error(`API-Football a répondu ${r.status}`);
  const data = await r.json();
  if (data?.errors && Array.isArray(data.errors) ? data.errors.length > 0 : Object.keys(data?.errors || {}).length > 0) {
    throw new Error(`Erreur API-Football : ${JSON.stringify(data.errors)}`);
  }
  return data?.response || [];
}

// Liste mondiale de tous les matchs actuellement en direct (toutes compétitions, tous
// pays), mutualisée entre tous les visiteurs du site via ce cache partagé — un seul appel
// en amont par fenêtre de 30s, quel que soit le nombre de matchs suivis en même temps.
export async function getAllLiveFixtures(key) {
  if (!key) return [];
  if (liveListCache && Date.now() - liveListCache.fetchedAt < LIVE_LIST_TTL_MS) {
    return liveListCache.fixtures;
  }
  if (liveListInFlight) return liveListInFlight;

  liveListInFlight = (async () => {
    try {
      const fixtures = await apiFootballFetch("/fixtures?live=all", key);
      liveListCache = { fixtures, fetchedAt: Date.now() };
      return fixtures;
    } catch (e) {
      // Erreur passagère (quota, réseau) : on préfère resservir la dernière liste connue
      // plutôt que de faire disparaître les événements déjà affichés.
      if (liveListCache) return liveListCache.fixtures;
      return [];
    } finally {
      liveListInFlight = null;
    }
  })();
  return liveListInFlight;
}

// Un match à venir ne change pas d'heure en cours de journée, contrairement à un
// score en direct : un cache nettement plus long que pour le direct (voir
// LIVE_LIST_TTL_MS) suffit largement, et c'est indispensable pour rester soutenable —
// couvrir les ~8 jours de la page "Matchs à venir" (un appel par jour calendaire)
// avec un cache aussi court que le direct épuiserait vite le quota gratuit
// d'API-Football (100 requêtes/jour, partagé avec le direct).
const UPCOMING_TTL_MS = 6 * 3600 * 1000; // 6h

const upcomingCache = new Map(); // "YYYY-MM-DD" -> { fixtures, fetchedAt }
const upcomingInFlight = new Map();

// Tous les matchs programmés pour UNE date donnée, toutes compétitions et tous pays
// confondus (y compris les catégories jeunes type U17/U19/U20 quand API-Football les
// couvre) : comble le trou laissé par football-data.org, dont le plan gratuit ne
// couvre qu'un nombre restreint de compétitions (voir lib/competitions.js) — même
// principe que getAllLiveFixtures, avec un cache adapté à des données qui changent
// beaucoup moins souvent.
export async function getFixturesByDate(dateStr, key) {
  if (!key) return [];
  const cached = upcomingCache.get(dateStr);
  if (cached && Date.now() - cached.fetchedAt < UPCOMING_TTL_MS) return cached.fixtures;

  const pending = upcomingInFlight.get(dateStr);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const fixtures = await apiFootballFetch(`/fixtures?date=${dateStr}`, key);
      upcomingCache.set(dateStr, { fixtures, fetchedAt: Date.now() });
      return fixtures;
    } catch (e) {
      if (cached) return cached.fixtures;
      return [];
    } finally {
      upcomingInFlight.delete(dateStr);
    }
  })();
  upcomingInFlight.set(dateStr, promise);
  return promise;
}

// Traduit un fixture "à venir" (statut API-Football "NS" = not started) vers le même
// format que mapFixtureToLiveMatch — seuls les matchs pas encore commencés doivent
// alimenter la page "Matchs à venir" ; le direct est déjà couvert séparément.
// `matchday` reste `null` (API-Football n'a pas cette notion de journée) : ce match
// n'apparaîtra simplement pas dans le carrousel de journées, sans casser son filtrage.
export function mapFixtureToUpcomingMatch(fixture) {
  const homeId = fixture?.teams?.home?.id;
  const awayId = fixture?.teams?.away?.id;
  return {
    id: `af-${fixture?.fixture?.id}`,
    status: "SCHEDULED",
    minute: null,
    matchday: null,
    utcDate: fixture?.fixture?.date || null,
    competition: {
      code: fixture?.league?.id != null ? `af-${fixture.league.id}` : "",
      name: fixture?.league?.name || "Compétition",
      area: fixture?.league?.country || "",
      emblem: fixture?.league?.logo || "",
    },
    homeTeam: { id: homeId != null ? `af-${homeId}` : "", name: fixture?.teams?.home?.name || "", crest: fixture?.teams?.home?.logo || "" },
    awayTeam: { id: awayId != null ? `af-${awayId}` : "", name: fixture?.teams?.away?.name || "", crest: fixture?.teams?.away?.logo || "" },
    score: { fullTime: { home: null, away: null } },
  };
}

const SUFFIX_WORDS = /\b(fc|cf|ac|sc|afc|cfc|sad|club)\b/g;

// Les deux API n'utilisent pas les mêmes identifiants d'équipe : on retrouve le bon match
// API-Football en comparant les noms d'équipe (normalisés : accents, casse, suffixes de
// club comme "FC"/"CF" retirés) à ceux déjà connus côté football-data.org.
export function normalizeTeamName(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(SUFFIX_WORDS, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function findLiveFixtureByTeams(fixtures, homeTeamName, awayTeamName) {
  const home = normalizeTeamName(homeTeamName);
  const away = normalizeTeamName(awayTeamName);
  if (!home || !away || !Array.isArray(fixtures)) return null;
  return (
    fixtures.find((f) => {
      const fHome = normalizeTeamName(f?.teams?.home?.name);
      const fAway = normalizeTeamName(f?.teams?.away?.name);
      return fHome === home && fAway === away;
    }) || null
  );
}

// Tout ce que renvoie /fixtures?live=all est par définition un match en cours (1ère/2e
// mi-temps, prolongations, tirs au but...) — seules la mi-temps et les pauses (HT, BT)
// méritent le statut PAUSED (affiché "MT" côté interface, voir components/MatchCard.js
// et MatchHeaderHero.js), le reste devient IN_PLAY comme pour football-data.org.
const BREAK_STATUSES = new Set(["HT", "BT"]);
function apiFootballStatusToBlumeStatus(short) {
  return BREAK_STATUSES.has(short) ? "PAUSED" : "IN_PLAY";
}

// football-data.org (plan gratuit) ne couvre qu'un nombre limité de compétitions : un
// match connu UNIQUEMENT par API-Football a besoin d'un id qui ne coïncide jamais, même
// par hasard, avec un vrai id football-data.org (les deux API numérotent leurs matchs et
// équipes indépendamment) — préfixé "af-" pour que le reste du site (routage,
// /api/analyze) sache reconnaître ces matchs et n'interroge jamais football-data.org
// avec un id qui pourrait désigner par coïncidence un tout autre match.
export function mapFixtureToLiveMatch(fixture) {
  const homeId = fixture?.teams?.home?.id;
  const awayId = fixture?.teams?.away?.id;
  return {
    id: `af-${fixture?.fixture?.id}`,
    status: apiFootballStatusToBlumeStatus(fixture?.fixture?.status?.short),
    minute: fixture?.fixture?.status?.elapsed ?? null,
    utcDate: fixture?.fixture?.date || new Date().toISOString(),
    competition: {
      code: fixture?.league?.id != null ? `af-${fixture.league.id}` : "",
      name: fixture?.league?.name || "Compétition",
      emblem: fixture?.league?.logo || "",
    },
    homeTeam: { id: homeId != null ? `af-${homeId}` : "", name: fixture?.teams?.home?.name || "", crest: fixture?.teams?.home?.logo || "" },
    awayTeam: { id: awayId != null ? `af-${awayId}` : "", name: fixture?.teams?.away?.name || "", crest: fixture?.teams?.away?.logo || "" },
    score: { fullTime: { home: fixture?.goals?.home ?? null, away: fixture?.goals?.away ?? null } },
  };
}

// Score/minute/statut en direct d'un match, au même format que renvoie
// lib/liveMatchCache.js (football-data.org) — utilisé par pages/api/analyze.js comme
// source de repli quand football-data.org ne connaît pas ce match (hors de ses
// compétitions couvertes, ou match identifié uniquement via un id "af-").
export function mapFixtureToLiveState(fixture) {
  return {
    status: apiFootballStatusToBlumeStatus(fixture?.fixture?.status?.short),
    minute: fixture?.fixture?.status?.elapsed ?? null,
    score: { fullTime: { home: fixture?.goals?.home ?? null, away: fixture?.goals?.away ?? null } },
    venue: fixture?.fixture?.venue?.name || null,
    referees: fixture?.fixture?.referee ? [{ name: fixture.fixture.referee }] : [],
  };
}

// Fil d'événements réel d'un match précis (identifié par son id API-Football, trouvé via
// findLiveFixtureByTeams) — mutualisé par match entre tous ses visiteurs, même principe
// que le reste du site. Renvoie `null` uniquement en cas d'échec réel (source vraiment
// indisponible) — un tableau vide est une réponse valide (aucun événement pour l'instant).
export async function getFixtureEvents(fixtureId, key) {
  if (!fixtureId || !key) return null;

  const cached = eventsCache.get(fixtureId);
  if (cached && Date.now() - cached.fetchedAt < EVENTS_TTL_MS) return cached.events;

  const pending = eventsInFlight.get(fixtureId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const raw = await apiFootballFetch(`/fixtures/events?fixture=${fixtureId}`, key);
      eventsCache.set(fixtureId, { events: raw, fetchedAt: Date.now() });
      return raw;
    } catch (e) {
      if (cached) return cached.events;
      return null;
    } finally {
      eventsInFlight.delete(fixtureId);
    }
  })();
  eventsInFlight.set(fixtureId, promise);
  return promise;
}

const RED_CARD_DETAILS = new Set(["Red Card", "Second Yellow card"]);

function mapEventType(rawType, detail) {
  if (rawType === "Goal") return detail === "Missed Penalty" ? null : "GOAL";
  if (rawType === "Card") return RED_CARD_DETAILS.has(detail) ? "RED_CARD" : "YELLOW_CARD";
  if (rawType === "subst" || rawType === "Subst") return "SUBSTITUTION";
  return null; // type non géré par l'interface (ex: VAR) : ignoré plutôt qu'affiché à tort
}

// Traduit le fil d'événements brut d'API-Football vers le format déjà utilisé par
// components/MatchTimeline.js — `teamId` est directement l'id football-data.org (domicile
// ou extérieur) déjà connu de pages/api/analyze.js, pas l'id API-Football, pour que le
// composant (qui compare teamId à homeTeamId) fonctionne sans aucune modification.
// Le score après chaque but est recalculé ici (API-Football ne le fournit pas
// directement par événement) à partir des vrais buts renvoyés — jamais une valeur
// inventée, seulement un cumul des événements réels dans l'ordre chronologique.
export function mapApiFootballEvents(rawEvents, { fixtureHomeId, homeTeamId, awayTeamId }) {
  const sorted = [...(rawEvents || [])].sort((a, b) => (a?.time?.elapsed ?? 0) - (b?.time?.elapsed ?? 0));
  let scoreHome = 0;
  let scoreAway = 0;
  const out = [];

  sorted.forEach((raw, i) => {
    const type = mapEventType(raw?.type, raw?.detail);
    if (!type) return;

    const eventIsHomeTeam = String(raw?.team?.id) === String(fixtureHomeId);
    const teamId = eventIsHomeTeam ? homeTeamId : awayTeamId;
    const minute = raw?.time?.elapsed ?? 0;

    const event = {
      id: `${minute}-${type}-${raw?.player?.id ?? i}`,
      minute,
      type,
      teamId,
    };

    if (type === "SUBSTITUTION") {
      // Convention API-Football pour les événements "subst" : `player` = le joueur qui
      // sort, `assist` = celui qui entre.
      event.playerOut = { name: raw?.player?.name || "?" };
      event.playerIn = { name: raw?.assist?.name || "?" };
    } else {
      event.player = { name: raw?.player?.name || "?" };
    }

    if (type === "GOAL") {
      const isOwnGoal = raw?.detail === "Own Goal";
      const scoringIsHome = isOwnGoal ? !eventIsHomeTeam : eventIsHomeTeam;
      if (scoringIsHome) scoreHome += 1;
      else scoreAway += 1;
      event.scoreAfter = { home: scoreHome, away: scoreAway };
    }

    out.push(event);
  });

  return out;
}

// Statistiques RÉELLES d'un match en direct (GET /fixtures/statistics) : corners,
// hors-jeu et fautes réellement comptabilisés depuis le début du match, par équipe —
// utilisées pour que les blocs Corners/Hors-jeu/Fautes (voir lib/pronostic.js,
// buildMatchStats) évoluent réellement selon ce qui se passe dans CE match précis, pas
// seulement une estimation figée pour toute la rencontre. Les touches (rentrées en
// jeu) n'existent PAS dans cette ressource API-Football : ce bloc reste une estimation
// pré-match (voir buildMatchStats). TTL court : cette donnée évolue en direct, comme
// les événements ci-dessus.
const FIXTURE_STATS_TTL_MS = 15000;
const fixtureStatsCache = new Map(); // fixtureId -> { stats, fetchedAt }
const fixtureStatsInFlight = new Map();

// Renvoie la réponse BRUTE (tableau de 2 entrées, une par équipe) — voir
// mapFixtureStatistics pour la traduction vers le format utilisé par le reste du site.
// `null` uniquement en cas d'échec réel (pas de clé, quota dépassé, erreur réseau) ;
// un tableau vide est une réponse valide (stats pas encore publiées en tout début de
// match) plutôt qu'une valeur inventée pour remplir le trou.
export async function getFixtureStatistics(fixtureId, key) {
  if (!fixtureId || !key) return null;

  const cached = fixtureStatsCache.get(fixtureId);
  if (cached && Date.now() - cached.fetchedAt < FIXTURE_STATS_TTL_MS) return cached.stats;

  const pending = fixtureStatsInFlight.get(fixtureId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const raw = await apiFootballFetch(`/fixtures/statistics?fixture=${fixtureId}`, key);
      fixtureStatsCache.set(fixtureId, { stats: raw, fetchedAt: Date.now() });
      return raw;
    } catch {
      return cached ? cached.stats : null;
    } finally {
      fixtureStatsInFlight.delete(fixtureId);
    }
  })();
  fixtureStatsInFlight.set(fixtureId, promise);
  return promise;
}

function statisticValue(statistics, type) {
  const entry = (statistics || []).find((s) => s?.type === type);
  const v = entry?.value;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// Traduit la réponse brute de getFixtureStatistics vers
// { corners: {home,away}, offsides: {home,away}, fouls: {home,away} } —
// `fixtureHomeId` (l'id API-Football, pas celui de football-data.org) sert à savoir
// laquelle des deux entrées correspond à l'équipe à domicile. Renvoie `null` si la
// réponse n'a pas la forme attendue (les deux équipes) plutôt qu'un objet à moitié
// rempli qui laisserait croire à une vraie donnée incomplète.
export function mapFixtureStatistics(raw, fixtureHomeId) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const homeEntry = raw.find((r) => String(r?.team?.id) === String(fixtureHomeId)) || raw[0];
  const awayEntry = raw.find((r) => r !== homeEntry) || raw[1];
  const pick = (entry) => ({
    corners: statisticValue(entry?.statistics, "Corner Kicks"),
    offsides: statisticValue(entry?.statistics, "Offsides"),
    fouls: statisticValue(entry?.statistics, "Fouls"),
  });
  const home = pick(homeEntry);
  const away = pick(awayEntry);
  return {
    corners: { home: home.corners, away: away.corners },
    offsides: { home: home.offsides, away: away.offsides },
    fouls: { home: home.fouls, away: away.fouls },
  };
}

// "Joueurs susceptibles de prendre un carton" (bloc "Corners et cartons") : football-
// data.org ne fournit aucune statistique par joueur de cartons (seulement buts/passes
// décisives, voir lib/scorersCache.js) — API-Football, quand une clé est disponible,
// a un vrai relevé saison par joueur (jaunes + rouges). On retrouve d'abord l'équipe
// par son NOM (recherche, pas une table de correspondance de compétitions à
// maintenir) : fonctionne pour n'importe quelle équipe, quelle que soit sa
// compétition football-data.org d'origine.
const TEAM_SEARCH_TTL_MS = 24 * 3600 * 1000; // 24h : l'identité d'une équipe ne change pas
const teamSearchCache = new Map(); // nom normalisé -> { teamId, fetchedAt }
const teamSearchInFlight = new Map(); // nom normalisé -> promesse en cours

export async function findApiFootballTeamId(teamName, key) {
  if (!key || !teamName) return null;
  const normalized = normalizeTeamName(teamName);
  const cached = teamSearchCache.get(normalized);
  if (cached && Date.now() - cached.fetchedAt < TEAM_SEARCH_TTL_MS) return cached.teamId;

  const pending = teamSearchInFlight.get(normalized);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const results = await apiFootballFetch(`/teams?search=${encodeURIComponent(teamName)}`, key);
      const found = results.find((r) => normalizeTeamName(r?.team?.name) === normalized) || results[0] || null;
      const teamId = found?.team?.id ?? null;
      teamSearchCache.set(normalized, { teamId, fetchedAt: Date.now() });
      return teamId;
    } catch {
      return cached ? cached.teamId : null;
    } finally {
      teamSearchInFlight.delete(normalized);
    }
  })();
  teamSearchInFlight.set(normalized, promise);
  return promise;
}

// Année de début de la saison en cours, au format attendu par API-Football pour les
// championnats à cheval sur deux années civiles (convention : saison "2024" = 2024-
// 2025) — dérivée de la vraie date du jour, jamais une valeur codée en dur. Approximatif
// pour les championnats calés sur l'année civile (ex : Brésil) ; dans ce cas, l'API
// renvoie simplement une liste vide plutôt qu'une donnée fausse (voir plus bas).
function currentApiFootballSeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

const CARD_PRONENESS_TTL_MS = 24 * 3600 * 1000; // 24h : un relevé de cartons saison ne change pas d'une minute à l'autre
const cardPronenessCache = new Map(); // teamId -> { players, fetchedAt }
const cardPronenessInFlight = new Map(); // teamId -> promesse en cours

// Les vrais joueurs les plus sujets aux cartons cette saison, pour UNE équipe (jaunes
// + rouges réellement comptabilisés par API-Football) — jamais un joueur inventé ;
// liste vide si la source est indisponible (pas de clé, équipe introuvable, saison
// sans donnée), affichée honnêtement comme "Indisponible" côté interface plutôt que
// masquée en silence.
export async function getTeamCardProneness(teamId, key) {
  if (!key || !teamId) return [];
  const cached = cardPronenessCache.get(teamId);
  if (cached && Date.now() - cached.fetchedAt < CARD_PRONENESS_TTL_MS) return cached.players;

  const pending = cardPronenessInFlight.get(teamId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const season = currentApiFootballSeason();
      const results = await apiFootballFetch(`/players?team=${teamId}&season=${season}`, key);
      const players = results
        .map((r) => {
          const stat = r?.statistics?.[0];
          return {
            name: r?.player?.name || null,
            yellow: stat?.cards?.yellow || 0,
            red: stat?.cards?.red || 0,
          };
        })
        .filter((p) => p.name && (p.yellow > 0 || p.red > 0))
        .sort((a, b) => (b.yellow + b.red * 3) - (a.yellow + a.red * 3))
        .slice(0, 4);
      cardPronenessCache.set(teamId, { players, fetchedAt: Date.now() });
      return players;
    } catch {
      return cached ? cached.players : [];
    } finally {
      cardPronenessInFlight.delete(teamId);
    }
  })();
  cardPronenessInFlight.set(teamId, promise);
  return promise;
}
