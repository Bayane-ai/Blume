// Filtres purs pour les deux sections demandées sur l'accueil football : "Ligue des
// Champions, Europa, Conference & championnats spécifiques" (Russie, Suède, Slovaquie,
// Lettonie) et "Tous les clubs, grandes compétitions en premier". Volontairement bâtis
// SUR LES MÊMES matchs déjà récupérés par pages/api/live-matches.js et pages/api/
// matches.js (football-data.org + API-Football, mêmes clés déjà en production, même
// cache/quota déjà testés partout ailleurs sur Blume) — jamais une nouvelle source de
// données séparée : la fiabilité vient d'ici, pas d'un nouvel appel réseau non
// vérifiable.
import { COMPETITIONS } from "./competitions";

// Noms de pays tels que renvoyés par API-Football (`league.country`, voir
// lib/apiFootball.js#mapFixtureToUpcomingMatch/#mapFixtureToLiveMatch) — la Russie, la
// Suède, la Slovaquie et la Lettonie ne sont PAS couvertes par football-data.org (plan
// gratuit) : ces 4 championnats ne peuvent venir que d'API-Football, jamais inventés
// si la clé API_FOOTBALL_KEY est absente ou si le plan configuré ne les couvre pas
// (auquel cas ces matchs manquent honnêtement, comme n'importe quel autre trou de
// couverture déjà documenté sur /admin).
const SPECIFIC_COUNTRIES = new Set(["russia", "sweden", "slovakia", "latvia"]);

// Exclusion best-effort des compétitions qui ne sont clairement PAS la première
// division (coupe, réserve, jeunes, féminines) quand un pays renvoie plusieurs
// compétitions — l'API ne marque pas explicitement "1ère division", donc ceci reste une
// heuristique par mot-clé, jamais une certitude absolue.
const NOT_TOP_FLIGHT = /\b(cup|coupe|reserve|réserve|youth|u1[7-9]|u2[0-1]|women|f[ée]minin|super\s?cup|supercoupe)\b/i;

function normalize(str) {
  return (str || "").toLowerCase().trim();
}

function isChampionsLeague(name) {
  return /champions league/i.test(name || "");
}
function isConferenceLeague(name) {
  return /conference league/i.test(name || "");
}
function isEuropaLeague(name) {
  return /europa league/i.test(name || "") && !isConferenceLeague(name);
}

// Un match appartient aux "compétitions spécifiques" demandées : LDC, Europa,
// Conference (par nom, ne collisionne avec aucun championnat national), ou 1ère
// division russe/suédoise/slovaque/lettone (par pays réel, `competition.area`).
export function isFeaturedSpecificCompetition(m) {
  const name = m?.competition?.name || "";
  if (isChampionsLeague(name) || isEuropaLeague(name) || isConferenceLeague(name)) return true;
  const country = normalize(m?.competition?.area);
  if (SPECIFIC_COUNTRIES.has(country) && !NOT_TOP_FLIGHT.test(name)) return true;
  return false;
}

const PRIORITY_ORDER = ["CL", "EUROPA", "CONFERENCE", "PL", "PD", "SA", "BL1", "FL1"];

function priorityKey(m) {
  const code = m?.competition?.code;
  const name = m?.competition?.name || "";
  if (code === "CL" || isChampionsLeague(name)) return "CL";
  if (isEuropaLeague(name)) return "EUROPA";
  if (isConferenceLeague(name)) return "CONFERENCE";
  if (code && ["PL", "PD", "SA", "BL1", "FL1"].includes(code)) return code;
  return null;
}

// "Tous les clubs, grandes compétitions en premier" (LDC/Europa/Conference puis
// Premier League/LaLiga/Serie A/Bundesliga/Ligue 1, voir lib/competitions.js pour ces 5
// derniers codes) — jamais un filtre : toute autre compétition réelle reste incluse,
// simplement après les grandes, triée par horaire.
export function rankForAllClubs(m) {
  const key = priorityKey(m);
  const idx = key ? PRIORITY_ORDER.indexOf(key) : -1;
  return idx === -1 ? PRIORITY_ORDER.length : idx;
}

function statusRank(status) {
  if (status === "IN_PLAY" || status === "PAUSED" || status === "EXTRA_TIME" || status === "PENALTY_SHOOTOUT") return 0;
  if (status === "SCHEDULED" || status === "TIMED") return 1;
  return 2; // FINISHED
}

// Fusionne matchs en direct + matchs à venir (voir pages/index.js), en dédupliquant par
// id (un match qui vient de démarrer peut apparaître dans les deux réponses selon le
// moment exact de l'actualisation) — jamais un doublon affiché.
export function mergeLiveAndUpcoming(liveMatches, upcomingMatches) {
  const byId = new Map();
  for (const m of [...(liveMatches || []), ...(upcomingMatches || [])]) {
    if (m?.id && m?.homeTeam && m?.awayTeam && m?.utcDate) byId.set(m.id, m);
  }
  return [...byId.values()];
}

export function sortByStatusThenDate(matches) {
  return [...matches].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || new Date(a.utcDate) - new Date(b.utcDate)
  );
}

export function sortByPriorityThenDate(matches) {
  return [...matches].sort((a, b) => rankForAllClubs(a) - rankForAllClubs(b) || new Date(a.utcDate) - new Date(b.utcDate));
}

export { COMPETITIONS };
