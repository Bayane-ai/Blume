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
