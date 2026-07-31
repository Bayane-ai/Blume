// Mapper basket (bloc 1) — normalise la réponse brute d'API-Basketball (API-SPORTS)
// vers la MÊME forme que le football (voir lib/apiFootball.js#mapFixtureToLiveMatch/
// mapFixtureToUpcomingMatch) : { id, status, minute, utcDate, competition, homeTeam,
// awayTeam, score } — pour que components/MatchCard.js (déjà écrit pour le football)
// puisse afficher un match de basket sans la moindre modification (bloc 2).
//
// Identifiants préfixés "bk-" (jamais "af-", déjà utilisé par API-Football pour le
// football) : un id de match/équipe/compétition basket ne doit jamais, même par
// coïncidence, être confondu avec un id football par le reste du site (routage,
// /api/analyze...).
const LIVE_STATUS_CODES = new Set(["Q1", "Q2", "Q3", "Q4", "OT"]);
const BREAK_STATUS_CODES = new Set(["HT", "BT"]);
const FINISHED_STATUS_CODES = new Set(["FT", "AOT"]);
const NOT_STARTED_STATUS_CODES = new Set(["NS", "TBD"]);

// Codes bruts API-Basketball -> statuts déjà utilisés partout ailleurs sur le site
// (LIVE_STATUSES/UPCOMING_STATUSES, voir pages/index.js et pages/a-venir.js) — un code
// pas encore répertorié (report, annulation...) reste affiché tel quel plutôt que
// silencieusement transformé en autre chose.
export function mapGameStatusToBlumeStatus(short) {
  if (LIVE_STATUS_CODES.has(short)) return "IN_PLAY";
  if (BREAK_STATUS_CODES.has(short)) return "PAUSED";
  if (FINISHED_STATUS_CODES.has(short)) return "FINISHED";
  if (NOT_STARTED_STATUS_CODES.has(short)) return "SCHEDULED";
  return short || "SCHEDULED";
}

function mapTeam(team) {
  return {
    id: team?.id != null ? `bk-${team.id}` : "",
    name: team?.name || "",
    crest: team?.logo || "",
  };
}

function mapCompetition(game) {
  return {
    code: game?.league?.id != null ? `bk-${game.league.id}` : "",
    name: game?.league?.name || "Compétition",
    area: game?.country?.name || "",
    emblem: game?.league?.logo || "",
    // Bloc 3 (pronostics) : saison réelle de CE match (ex: "2024-2025"), transmise
    // telle quelle par components/MatchCard.js#matchHref jusqu'à
    // pages/api/basketball/analyze.js — sans elle, impossible d'interroger le vrai
    // historique de chaque équipe pour LA bonne saison.
    season: game?.league?.season != null ? String(game.league.season) : "",
  };
}

// Le score total (`scores.home.total`/`scores.away.total`) — jamais la somme des
// quart-temps recalculée ici : c'est déjà le total officiel renvoyé par la source.
function mapScore(game) {
  return { fullTime: { home: game?.scores?.home?.total ?? null, away: game?.scores?.away?.total ?? null } };
}

// PROMPT bloc 2 : "quart-temps en cours (Q1/Q2/Q3/Q4/Prolongation) et le chrono" —
// `period` porte le quart-temps réel (voir lib/liveClockFormat.js, qui l'affiche avec
// `minute`, le chrono officiel de la source, jamais recalculé ici) ; `null` pour tout
// statut qui n'est pas un quart-temps/une prolongation (avant/après match), jamais une
// valeur inventée.
const PERIOD_CODES = new Set(["Q1", "Q2", "Q3", "Q4", "OT"]);

export function mapGameToLiveMatch(game) {
  const short = game?.status?.short;
  return {
    id: game?.id != null ? `bk-${game.id}` : "",
    status: mapGameStatusToBlumeStatus(short),
    minute: game?.status?.timer || null,
    period: PERIOD_CODES.has(short) ? short : null,
    utcDate: game?.date || new Date().toISOString(),
    competition: mapCompetition(game),
    homeTeam: mapTeam(game?.teams?.home),
    awayTeam: mapTeam(game?.teams?.away),
    score: mapScore(game),
  };
}

export function mapGameToUpcoming(game) {
  return {
    id: game?.id != null ? `bk-${game.id}` : "",
    status: mapGameStatusToBlumeStatus(game?.status?.short),
    minute: null,
    matchday: null,
    utcDate: game?.date || null,
    competition: mapCompetition(game),
    homeTeam: mapTeam(game?.teams?.home),
    awayTeam: mapTeam(game?.teams?.away),
    score: mapScore(game),
  };
}

// Rétro-compatibilité avec l'interface définie au bloc 0 (voir lib/sports/tennis/
// mapper.js, qui garde encore les noms génériques `mapMatchToLiveState`/
// `mapMatchToUpcoming`) — mêmes fonctions, noms alignés sur le vocabulaire basket
// ("game" plutôt que "match", "match" pour football) utilisé par API-Basketball.
export const mapMatchToLiveState = mapGameToLiveMatch;
export const mapMatchToUpcoming = mapGameToUpcoming;
