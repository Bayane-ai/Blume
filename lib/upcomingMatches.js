// Couche unifiée de l'onglet "Matchs à venir" (page /a-venir) — fusion de l'ancien
// onglet "Matchs du jour" et de l'ancienne page "Matchs à venir".
//
// Principe : pour CHAQUE sport, on agrège TOUTES les sources disponibles, on
// déduplique, on ne garde que les matchs PAS ENCORE COMMENCÉS de maintenant à J+7,
// puis on groupe par jour (fuseau du visiteur) et par compétition.
//
// Sources par sport :
//   football   : SportScore + /api/matches (football-data.org + API-Football)
//   basketball : SportScore + /api/basketball/matches (API-Basketball)
//   tennis     : SportScore UNIQUEMENT (le plan gratuit de Live Tennis API n'expose
//                pas de calendrier ; elle ne sert donc plus que pour le direct)
//
// AUCUN filtre de compétition, de pays, de division, de catégorie d'âge ni
// d'importance : toutes fédérations, toutes divisions, coupes, jeunes (U17/U19/U20),
// réserves, féminines, amicaux et petites compétitions sont conservés. Les grandes
// compétitions sont seulement REMONTÉES dans l'ordre d'affichage, jamais les autres
// écartées (voir competitionRank).
import { fetchSportScoreMatches, competitionRank } from "./sportScore";

// Fenêtre demandée : de l'instant présent à J+7.
export const HORIZON_DAYS = 7;

// Sources maison par sport. Le TENNIS n'y figure volontairement PAS : la route
// /api/tennis/matches répond "unsupported" en dur (le plan gratuit de Live Tennis API
// n'expose pas de calendrier), et ce message éclipsait les matchs pourtant disponibles
// ailleurs. Les matchs à venir du tennis viennent désormais de SportScore ; Live
// Tennis API ne sert plus QUE pour le direct (voir pages/api/tennis/live-matches.js).
const BLUME_ROUTES = {
  football: "/api/matches",
  basketball: "/api/basketball/matches",
};

// Statuts Blume considérés comme "pas encore commencé". Tout le reste (IN_PLAY,
// PAUSED, FINISHED...) appartient à l'onglet Live ou à l'historique, jamais ici.
const NOT_STARTED = new Set(["SCHEDULED", "TIMED"]);

function text(v) {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// Forme interne commune à toutes les sources, pour que l'affichage soit identique
// quelle que soit la provenance du match.
function normalizeBlume(m, sport) {
  return {
    id: String(m?.id ?? ""),
    sport,
    home: { name: text(m?.homeTeam?.name), logo: text(m?.homeTeam?.crest) },
    away: { name: text(m?.awayTeam?.name), logo: text(m?.awayTeam?.crest) },
    competition: text(m?.competition?.name),
    // Pays/fédération, affiché à côté du nom de la compétition quand la source le
    // fournit (football-data.org et API-Football le donnent ; SportScore, non).
    area: text(m?.competition?.area),
    startTime: text(m?.utcDate),
    status: m?.status || null,
    // Conserve la forme d'origine : la carte doit pouvoir construire le lien
    // "Analyser" exactement comme ailleurs sur le site (voir components/MatchCard.js).
    raw: m,
  };
}

function normalizeSportScore(m) {
  return {
    id: String(m?.id ?? ""),
    sport: m?.sport,
    home: m?.home || { name: null, logo: null },
    away: m?.away || { name: null, logo: null },
    competition: m?.competition || null,
    area: null,
    startTime: m?.startTime || null,
    status: m?.status === "upcoming" ? "SCHEDULED" : m?.status === "live" ? "IN_PLAY" : "FINISHED",
    raw: null,
  };
}

// Clé de déduplication : deux équipes + horaire de coup d'envoi, demandé explicitement.
// Les noms sont normalisés (accents, casse, suffixes de club) et l'horaire arrondi à
// 15 minutes — deux sources donnent rarement la seconde exacte pour le même match.
export function dedupeKey(m) {
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\b(fc|cf|ac|sc|afc|cfc|sad|club)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  const t = m.startTime ? Math.round(new Date(m.startTime).getTime() / 900000) : "?";
  // Ordre des équipes neutralisé : une source peut inverser domicile/extérieur.
  const teams = [norm(m.home?.name), norm(m.away?.name)].sort().join("|");
  return `${m.sport}|${teams}|${t}`;
}

export function dedupe(matches) {
  const seen = new Map();
  for (const m of matches) {
    const key = dedupeKey(m);
    const existing = seen.get(key);
    // À doublon égal, on garde la version la plus riche (celle qui porte un pays et/ou
    // une forme brute exploitable pour le lien "Analyser").
    if (!existing) seen.set(key, m);
    else if (!existing.raw && m.raw) seen.set(key, m);
    else if (!existing.area && m.area) seen.set(key, m);
  }
  return [...seen.values()];
}

// Ne garde que les matchs réellement À VENIR, dans la fenêtre demandée. Un match qui
// démarre quitte donc automatiquement cette liste au rafraîchissement suivant.
export function keepUpcoming(matches, { now = Date.now(), horizonDays = HORIZON_DAYS } = {}) {
  const limit = now + horizonDays * 24 * 3600 * 1000;
  return matches.filter((m) => {
    if (!m.home?.name || !m.away?.name || !m.startTime) return false;
    if (m.status && !NOT_STARTED.has(m.status)) return false;
    const t = new Date(m.startTime).getTime();
    return Number.isFinite(t) && t > now && t <= limit;
  });
}

// Clé de jour dans le fuseau LOCAL du visiteur (jamais la date UTC brute, qui ferait
// basculer un match de 23h dans le mauvais jour pour une bonne partie du monde).
export function localDayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(key, now = new Date()) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  const label = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Hiérarchie d'affichage demandée : jour -> compétition -> matchs.
// Les jours sont chronologiques ; à l'intérieur d'un jour, les grandes compétitions
// remontent (competitionRank) sans que jamais aucune autre ne soit écartée ; à
// l'intérieur d'une compétition, les matchs sont triés par heure croissante.
export function groupByDayThenCompetition(matches, sport, now = new Date()) {
  const days = new Map();
  for (const m of matches) {
    const key = localDayKey(m.startTime);
    if (!days.has(key)) days.set(key, new Map());
    const comps = days.get(key);
    const compKey = m.competition || "Compétition non communiquée";
    if (!comps.has(compKey)) comps.set(compKey, { competition: compKey, area: m.area || null, matches: [] });
    const group = comps.get(compKey);
    if (!group.area && m.area) group.area = m.area;
    group.matches.push(m);
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, comps]) => ({
      key,
      label: dayLabel(key, now),
      competitions: [...comps.values()]
        .sort(
          (a, b) =>
            competitionRank(a.competition, sport) - competitionRank(b.competition, sport) ||
            a.competition.localeCompare(b.competition)
        )
        .map((g) => ({ ...g, matches: [...g.matches].sort((x, y) => new Date(x.startTime) - new Date(y.startTime)) })),
    }));
}

// Récupère la source maison du sport. Ne lève pas : une source indisponible ne doit
// jamais empêcher l'autre de remplir la liste — l'erreur est renvoyée pour être
// journalisée et affichée, jamais avalée en silence.
async function loadBlumeSource(sport, fetchImpl) {
  const route = BLUME_ROUTES[sport];
  if (!route) return { matches: [], error: null };
  try {
    const res = await fetchImpl(route, { headers: { Accept: "application/json" } });
    // Seul un `ok` explicitement faux est une erreur : une implémentation de fetch qui
    // n'expose pas ce champ (client léger, test) ne doit pas être prise pour une panne.
    if (res.ok === false) throw new Error(`${route} : HTTP ${res.status}`);
    const payload = await res.json();
    const flat = Array.isArray(payload?.competitions)
      ? payload.competitions.flatMap((c) => c?.matches || [])
      : payload?.matches || [];
    return { matches: flat.map((m) => normalizeBlume(m, sport)), error: null };
  } catch (e) {
    return { matches: [], error: e.message };
  }
}

async function loadSportScoreSource(sport, fetchImpl) {
  try {
    const list = await fetchSportScoreMatches(sport, { fetchImpl });
    return { matches: list.map(normalizeSportScore), error: null, meta: list.meta || null };
  } catch (e) {
    return { matches: [], error: e.message, meta: null };
  }
}

// Point d'entrée unique de la page. Renvoie les jours prêts à afficher, plus un
// rapport de couverture (comptage par source, total de compétitions et de matchs) —
// c'est ce rapport que l'interface journalise et compare à ce qu'elle rend réellement.
export async function loadUpcoming(sport, { fetchImpl = fetch, now = Date.now() } = {}) {
  const [ss, blume] = await Promise.all([
    loadSportScoreSource(sport, fetchImpl),
    loadBlumeSource(sport, fetchImpl),
  ]);

  const merged = dedupe([...ss.matches, ...blume.matches]);
  const upcoming = keepUpcoming(merged, { now });
  const days = groupByDayThenCompetition(upcoming, sport, new Date(now));

  const competitions = new Set(upcoming.map((m) => m.competition || "Compétition non communiquée"));

  return {
    days,
    coverage: {
      sport,
      fromSportScore: ss.matches.length,
      fromBlume: blume.matches.length,
      afterDedupe: merged.length,
      upcoming: upcoming.length,
      competitions: competitions.size,
      pagesRead: ss.meta?.pages ?? null,
    },
    // Les deux sources ont échoué : c'est le seul cas d'erreur réelle. Si une seule
    // échoue, la liste se remplit quand même et l'incident reste journalisé.
    errors: { sportScore: ss.error, blume: blume.error },
    allSourcesFailed: Boolean(ss.error && blume.error),
  };
}
