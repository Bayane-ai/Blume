// Mapper tennis (bloc 5, multi-sport) — normalise la réponse brute d'API-Tennis vers
// la MÊME forme que le football/basket (voir lib/apiFootball.js, lib/sports/
// basketball/mapper.js) : { id, status, minute, period, utcDate, competition,
// homeTeam, awayTeam, score } — pour que components/MatchCard.js/MatchInfoBlock.js
// (déjà écrits pour le football/basket) affichent un match de tennis SANS changement
// structurel. Le bloc 6 (voir PROMPT) a ajouté quelques champs propres au tennis
// (surface/tour déjà présents depuis le bloc 5, plus `flag` par joueur et `server`
// ci-dessous) que MatchInfoBlock.js rend désormais de façon conditionnelle — inertes
// pour le football/basket, qui ne renseignent jamais ces champs. Identifiants
// préfixés "tn-" (jamais "af-"/"bk-", déjà utilisés) : un id de match/joueur/tournoi
// tennis ne doit jamais, même par coïncidence, être confondu avec un id d'un autre
// sport par le reste du site.
//
// ⚠️ Même avertissement que lib/sports/tennis/provider.js : la forme exacte de la
// réponse d'API-Tennis n'a pas pu être vérifiée en direct depuis cet environnement
// (réseau bloqué). API-SPORTS réutilise généralement `teams.home`/`teams.away` même
// pour un sport individuel (cohérence de leurs SDKs entre sports par équipes et
// individuels) — c'est l'hypothèse retenue ici pour le nom du joueur/l'identifiant,
// avec un repli sur `players.home`/`players.away` si `teams` est absent. Champ par
// champ, chaque hypothèse est commentée ci-dessous ; corrige en un endroit si la
// vraie forme diffère.

// PROMPT bloc 5, point 3 : "il y a du tennis en direct presque 24h/24, ne filtre
// aucun tournoi" — la détection de statut ci-dessous se fait par mot-clé (pas par
// code exact comme Q1-Q4 au basket, où le vocabulaire est déjà bien connu) car le
// vocabulaire exact des statuts tennis d'API-SPORTS n'a pas pu être confirmé en
// direct depuis cet environnement — plus robuste face à une variante de casse/forme
// qu'une correspondance exacte fragile.
function statusText(raw) {
  return `${raw?.long || ""} ${raw?.short || ""}`.toLowerCase();
}

export function mapMatchStatusToBlumeStatus(rawStatus) {
  const text = statusText(rawStatus);
  if (!text.trim()) return "SCHEDULED";
  if (/not\s*start|scheduled|^ns$/.test(text)) return "SCHEDULED";
  if (/walkover|retired|finished|ended|^ft$/.test(text)) return "FINISHED";
  if (/cancel|postpon|suspend|interrupt/.test(text)) return (rawStatus?.short || rawStatus?.long || "SUSPENDED").toUpperCase();
  if (/break|change.?over|rain\s*delay/.test(text)) return "PAUSED";
  // "Set 1", "Set 2", "1st Set"... ou tout texte contenant explicitement un numéro de
  // set en cours : considéré en direct.
  if (/set/.test(text)) return "IN_PLAY";
  return rawStatus?.short || rawStatus?.long || "SCHEDULED";
}

// Drapeau du joueur (PROMPT bloc 6, point 1 : "noms des deux joueurs + drapeaux") —
// tenté à plusieurs emplacements plausibles (API-SPORTS fournit déjà `country.flag`
// pour les compétitions par équipe nationale côté football ; on suppose la même
// convention pour un joueur individuel), jamais une image inventée quand absente.
function mapFlag(entry) {
  return entry?.flag || entry?.country?.flag || null;
}

function mapPlayer(entry) {
  return {
    id: entry?.id != null ? `tn-${entry.id}` : "",
    name: entry?.name || "",
    crest: entry?.logo || entry?.photo || "",
    flag: mapFlag(entry),
  };
}

function homeRaw(game) {
  return game?.teams?.home || game?.players?.home || game?.home || null;
}
function awayRaw(game) {
  return game?.teams?.away || game?.players?.away || game?.away || null;
}

// La surface (Dur/Terre battue/Gazon/Moquette — voir PROMPT bloc 5, point 2) est
// tentée directement sur le match (plusieurs emplacements plausibles selon la
// source), jamais une valeur inventée quand elle est réellement absente.
const SURFACE_LABELS = { hard: "Dur", clay: "Terre battue", grass: "Gazon", carpet: "Moquette", indoor: "Indoor" };
export function mapSurface(game) {
  const raw = game?.tournament?.surface || game?.league?.surface || game?.surface || null;
  if (!raw) return null;
  const key = String(raw).toLowerCase();
  return SURFACE_LABELS[key] || raw;
}

function mapCompetition(game) {
  const league = game?.league || game?.tournament || {};
  return {
    code: league?.id != null ? `tn-${league.id}` : "",
    name: league?.name || "Tournoi",
    area: game?.country?.name || league?.country || "",
    emblem: league?.logo || "",
    surface: mapSurface(game),
    // Catégorie réelle (ATP/WTA/Grand Chelem/Masters 1000/ATP 250/500/Challenger/
    // ITF...) — jamais filtrée nulle part (voir PROMPT bloc 5, point 3), transmise
    // telle quelle pour affichage/contexte seulement.
    category: league?.type || league?.category || "",
    season: game?.season != null ? String(game.season) : "",
  };
}

const SET_KEYS = ["set_1", "set_2", "set_3", "set_4", "set_5"];

// Sets déjà joués (ou en cours), un par un — score par set le plus fin que la source
// fournit de façon fiable. Le vrai score "point par point" (chaque point AU SEIN d'un
// jeu) n'est en général exposé par aucune source grand public/bêta, même premium —
// jamais inventé ici : `sets` reste la donnée la plus fine réellement disponible.
function mapSets(game) {
  const home = game?.scores?.home || {};
  const away = game?.scores?.away || {};
  const sets = [];
  for (const key of SET_KEYS) {
    const h = home[key];
    const a = away[key];
    if (h == null && a == null) continue;
    sets.push({ home: h, away: a });
  }
  return sets;
}

// Sets GAGNÉS par chaque joueur jusqu'ici (le nombre qui compte comme "score" du
// match, comme les buts/points pour les autres sports) — dérivé des vrais sets déjà
// complets (celui où les deux valeurs sont connues), jamais une estimation. Si la
// source fournit directement un total de sets gagnés, on le préfère (plus fiable
// qu'un recalcul, en cas de walkover/retrait en cours de set).
function computeSetsWon(game, sets) {
  const directHome = game?.scores?.home?.total;
  const directAway = game?.scores?.away?.total;
  if (Number.isFinite(directHome) && Number.isFinite(directAway)) return { home: directHome, away: directAway };
  let home = 0;
  let away = 0;
  for (const s of sets) {
    if (!Number.isFinite(s.home) || !Number.isFinite(s.away)) continue;
    if (s.home > s.away) home += 1;
    else if (s.away > s.home) away += 1;
  }
  return { home, away };
}

// Score du jeu EN COURS dans le set actuel ("40-30", "AD-40"...) quand la source le
// fournit — affiché à côté du numéro de set (voir lib/liveClockFormat.js, qui
// compose déjà `period · minute` de façon générique, sans changement nécessaire ici).
function mapCurrentGameScore(game) {
  return game?.scores?.home?.game != null && game?.scores?.away?.game != null
    ? `${game.scores.home.game}-${game.scores.away.game}`
    : null;
}

// Numéro du set en cours (uniquement si le match est réellement en direct) — dérivé
// du nombre de sets déjà présents dans la réponse, jamais un statut inventé.
function currentSetLabel(sets, isLive) {
  if (!isLive || sets.length === 0) return null;
  return `Set ${sets.length}`;
}

// Joueur actuellement au service (PROMPT bloc 6, point 1) — tenté à plusieurs
// emplacements plausibles (booléen par joueur, ou champ direct "home"/"away" sur le
// match), jamais deviné : `null` si la source ne le fournit pas clairement, plutôt
// qu'un service affiché à tort à un joueur qui ne sert pas.
function mapServer(game) {
  if (game?.scores?.home?.serve === true) return "home";
  if (game?.scores?.away?.serve === true) return "away";
  if (game?.players?.home?.serve === true) return "home";
  if (game?.players?.away?.serve === true) return "away";
  const raw = game?.serve;
  if (raw === "home" || raw === "away") return raw;
  return null;
}

export function mapMatchToLiveState(game) {
  const status = mapMatchStatusToBlumeStatus(game?.status);
  const isLive = status === "IN_PLAY";
  const sets = mapSets(game);
  const setsWon = computeSetsWon(game, sets);
  return {
    id: game?.id != null ? `tn-${game.id}` : "",
    status,
    minute: isLive ? mapCurrentGameScore(game) : null,
    period: currentSetLabel(sets, isLive),
    utcDate: game?.date || new Date().toISOString(),
    competition: mapCompetition(game),
    homeTeam: mapPlayer(homeRaw(game)),
    awayTeam: mapPlayer(awayRaw(game)),
    score: { fullTime: setsWon },
    // Données supplémentaires (PROMPT bloc 5, point 2) — pas encore consommées par
    // components/MatchCard.js (qui n'affiche que le score de sets, comme les autres
    // sports), disponibles pour le futur bloc pronostics tennis (bloc 7) et pour un
    // futur détail de match plus riche.
    sets,
    round: game?.round || null,
    // Uniquement pertinent en direct (voir components/MatchInfoBlock.js) — jamais
    // renseigné pour un match pas encore commencé.
    server: isLive ? mapServer(game) : null,
  };
}

// Statistiques RÉELLES d'un joueur sur UN match précis (aces, doubles fautes, %
// premier service, % de points gagnés derrière le 1er/2e service, balles de break
// converties) — source : lib/sports/tennis/provider.js#getGameStatistics. Comme pour
// le reste de ce fichier (voir l'avertissement en tête), la forme exacte de la
// réponse n'a pas pu être vérifiée en direct (réseau bloqué dans cet environnement) :
// on suit ici la même convention `statistics: [{type, value}]` par joueur que
// l'équivalent football déjà VÉRIFIÉ et fonctionnel de ce projet (voir
// lib/apiFootball.js#mapFixtureStatistics), sous la même hypothèse de cohérence entre
// produits d'un même fournisseur (API-SPORTS) déjà retenue pour tout le reste du
// module tennis. `value` peut être un nombre, un pourcentage ("62%") ou une fraction
// ("4/7", ex. balles de break) selon le type de statistique — jamais une valeur
// inventée quand le champ est absent ou dans une forme imprévue.
function parseStatValue(raw) {
  if (typeof raw === "number") return { value: raw, made: null, attempted: null };
  if (typeof raw !== "string") return { value: null, made: null, attempted: null };
  const trimmed = raw.trim();
  const fractionMatch = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fractionMatch) {
    const made = Number(fractionMatch[1]);
    const attempted = Number(fractionMatch[2]);
    return { value: attempted > 0 ? Math.round((made / attempted) * 1000) / 10 : null, made, attempted };
  }
  const percentMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) return { value: Number(percentMatch[1]), made: null, attempted: null };
  const numeric = Number(trimmed);
  return { value: Number.isFinite(numeric) ? numeric : null, made: null, attempted: null };
}

const STAT_TYPE_ALIASES = {
  aces: ["Aces", "Ace"],
  doubleFaults: ["Double Faults", "Doubles Fautes"],
  firstServeInPct: ["1st Serve", "1st Serve %", "First Serve"],
  firstServeWonPct: ["1st Serve Points Won", "1st Serve Won"],
  secondServeWonPct: ["2nd Serve Points Won", "2nd Serve Won"],
  breakPointsWon: ["Break Points Won", "Break Points Converted"],
  serviceGamesWonPct: ["Service Games Won"],
};

function findStatEntry(list, type, aliases) {
  return (list || []).find((s) => aliases.includes(s?.type));
}

function extractPlayerStats(statistics) {
  const out = {};
  for (const [key, aliases] of Object.entries(STAT_TYPE_ALIASES)) {
    const entry = findStatEntry(statistics, key, aliases);
    out[key] = entry ? parseStatValue(entry.value) : { value: null, made: null, attempted: null };
  }
  return out;
}

// `raw` : réponse brute de getGameStatistics (tableau, un élément par joueur).
// `homeId` : id API-Tennis (pas préfixé "tn-") du joueur à domicile de CE match, pour
// distinguer les deux entrées. Renvoie `null` si la réponse n'a pas la forme attendue
// (moins de deux entrées) plutôt qu'un objet à moitié rempli qui laisserait croire à
// une vraie donnée incomplète.
export function mapGameStatistics(raw, homeId) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const homeEntry =
    raw.find((r) => String(r?.team?.id ?? r?.player?.id) === String(homeId)) || raw[0];
  const awayEntry = raw.find((r) => r !== homeEntry) || raw[1];
  return {
    home: extractPlayerStats(homeEntry?.statistics),
    away: extractPlayerStats(awayEntry?.statistics),
  };
}

export function mapMatchToUpcoming(game) {
  return {
    id: game?.id != null ? `tn-${game.id}` : "",
    status: mapMatchStatusToBlumeStatus(game?.status),
    minute: null,
    matchday: null,
    utcDate: game?.date || null,
    competition: mapCompetition(game),
    homeTeam: mapPlayer(homeRaw(game)),
    awayTeam: mapPlayer(awayRaw(game)),
    score: { fullTime: { home: null, away: null } },
    round: game?.round || null,
  };
}
