// Mapper tennis — normalise la réponse brute de Live Tennis API (voir lib/sports/
// tennis/provider.js) vers la MÊME forme que le football/basket : { id, status,
// minute, period, utcDate, competition, homeTeam, awayTeam, score, sets, round,
// server } — pour que components/MatchCard.js/MatchInfoBlock.js/MatchHeaderHero.js
// (déjà écrits pour le football/basket) affichent un match de tennis SANS changement
// structurel. Identifiants préfixés "tn-" (jamais "af-"/"bk-", déjà utilisés).
//
// ⚠️ Forme exacte non vérifiable en direct depuis ce sandbox (réseau bloqué vers tout
// domaine tiers) : chaque champ est tenté à plusieurs emplacements plausibles pour une
// API REST de scores tennis en direct, JAMAIS une valeur inventée quand absente.
// `mapLiveTennisMatch(rawMatch, rawScore)` fusionne DEUX réponses (liste + détail —
// voir PROMPT : "GET /matches/{id}/score" est un endpoint séparé) : `rawScore` est
// `null` quand le détail n'a pas encore été demandé/n'est pas disponible, auquel cas
// on retombe sur ce que la liste elle-même fournissait déjà (souvent moins précis,
// mais jamais rien).

function statusText(raw) {
  // Normalise tirets/underscores en espaces : la forme exacte des statuts n'est pas
  // vérifiable en direct (réseau bloqué), une API REST peut tout aussi bien renvoyer
  // "not_started" que "not started" — jamais deux regex séparées à maintenir.
  return String(raw ?? "").toLowerCase().replace(/[_-]/g, " ");
}

export function mapMatchStatusToBlumeStatus(rawStatus) {
  const text = statusText(rawStatus);
  if (!text.trim()) return "SCHEDULED";
  if (/not\s*start|scheduled|upcoming|^ns$/.test(text)) return "SCHEDULED";
  if (/walkover|retired|finished|completed|ended|^ft$/.test(text)) return "FINISHED";
  if (/cancel|postpon|suspend|interrupt/.test(text)) return "SUSPENDED";
  if (/break|change.?over|rain\s*delay/.test(text)) return "PAUSED";
  if (/live|in.?progress|set/.test(text)) return "IN_PLAY";
  return rawStatus ? String(rawStatus).toUpperCase() : "SCHEDULED";
}

function mapFlag(entry) {
  return entry?.flag || entry?.country?.flag || entry?.countryCode || null;
}

function playerRaw(match, side) {
  // `side` : "home" ou "away". Essaie plusieurs conventions plausibles
  // (player1/player2, home/away, players[0]/players[1]).
  if (side === "home") return match?.player1 || match?.home || match?.players?.[0] || match?.teams?.home || null;
  return match?.player2 || match?.away || match?.players?.[1] || match?.teams?.away || null;
}

function mapPlayer(entry) {
  return {
    id: entry?.id != null ? `tn-${entry.id}` : "",
    name: entry?.name || entry?.fullName || "",
    crest: entry?.photo || entry?.picture || "",
    flag: mapFlag(entry),
    ranking: Number.isFinite(entry?.ranking) ? entry.ranking : Number.isFinite(Number(entry?.ranking)) ? Number(entry.ranking) : null,
  };
}

const SURFACE_LABELS = { hard: "Dur", clay: "Terre battue", grass: "Gazon", carpet: "Moquette", indoor: "Indoor" };
export function mapSurface(match) {
  const raw = match?.tournament?.surface || match?.surface || null;
  if (!raw) return null;
  const key = String(raw).toLowerCase();
  return SURFACE_LABELS[key] || raw;
}

function mapCompetition(match) {
  const tournament = match?.tournament || match?.event || {};
  return {
    code: tournament?.id != null ? `tn-${tournament.id}` : "",
    name: tournament?.name || "Tournoi",
    area: tournament?.country || "",
    emblem: "",
    surface: mapSurface(match),
    category: tournament?.category || tournament?.type || "",
    season: "",
  };
}

// Sets : accepte `[{p1,p2}]`/`[{home,away}]`/`[{player1,player2}]` — plusieurs
// conventions plausibles pour un tableau de sets, jamais une valeur inventée pour un
// set réellement absent de la réponse.
function normalizeSetEntry(s) {
  const home = s?.home ?? s?.p1 ?? s?.player1 ?? null;
  const away = s?.away ?? s?.p2 ?? s?.player2 ?? null;
  if (home == null && away == null) return null;
  return { home: Number.isFinite(home) ? home : Number(home), away: Number.isFinite(away) ? away : Number(away) };
}

function mapSets(rawScore) {
  const rawSets = rawScore?.sets || rawScore?.score?.sets || [];
  if (!Array.isArray(rawSets)) return [];
  return rawSets.map(normalizeSetEntry).filter(Boolean);
}

function computeSetsWon(sets) {
  let home = 0;
  let away = 0;
  for (const s of sets) {
    if (!Number.isFinite(s.home) || !Number.isFinite(s.away)) continue;
    if (s.home > s.away) home += 1;
    else if (s.away > s.home) away += 1;
  }
  return { home, away };
}

function mapCurrentGameScore(rawScore) {
  const g = rawScore?.currentGame || rawScore?.point || rawScore?.game || null;
  if (!g) return null;
  const home = g.home ?? g.p1 ?? g.player1;
  const away = g.away ?? g.p2 ?? g.player2;
  if (home == null || away == null) return null;
  return `${home}-${away}`;
}

function currentSetLabel(sets, isLive) {
  if (!isLive || sets.length === 0) return null;
  return `Set ${sets.length}`;
}

function mapServer(rawScore) {
  const raw = rawScore?.server ?? rawScore?.serving;
  if (raw === "player1" || raw === "home" || raw === 1 || raw === "1") return "home";
  if (raw === "player2" || raw === "away" || raw === 2 || raw === "2") return "away";
  return null;
}

// `rawMatch` : un élément de GET /matches?status=live. `rawScore` : réponse (optionnelle,
// peut être `null`) de GET /matches/{id}/score pour CE match — voir PROMPT, endpoint
// séparé du détail. Les DEUX sont fusionnés ici, jamais deux mappers distincts qui
// pourraient diverger sur la forme finale du match.
export function mapLiveTennisMatch(rawMatch, rawScore = null) {
  const status = mapMatchStatusToBlumeStatus(rawMatch?.status);
  const isLive = status === "IN_PLAY";
  const sets = mapSets(rawScore) ;
  // Repli sur un score déjà présent dans la liste elle-même (certaines API de score
  // en direct incluent un résumé même sans appeler le détail séparément) — jamais
  // recalculé si `rawScore` a déjà fourni des sets exploitables.
  const setsFallback = sets.length > 0 ? sets : mapSets({ sets: rawMatch?.sets || rawMatch?.score?.sets });
  const setsWon = computeSetsWon(setsFallback);
  return {
    id: rawMatch?.id != null ? `tn-${rawMatch.id}` : "",
    status,
    minute: isLive ? mapCurrentGameScore(rawScore) : null,
    period: currentSetLabel(setsFallback, isLive),
    utcDate: rawMatch?.date || rawMatch?.startTime || new Date().toISOString(),
    competition: mapCompetition(rawMatch),
    homeTeam: mapPlayer(playerRaw(rawMatch, "home")),
    awayTeam: mapPlayer(playerRaw(rawMatch, "away")),
    score: { fullTime: setsWon },
    sets: setsFallback,
    round: rawMatch?.round || null,
    server: isLive ? mapServer(rawScore) : null,
  };
}

// Rétro-compatibilité de nommage avec le reste du site (voir lib/sports/basketball/
// mapper.js, même convention) — `mapMatchToLiveState` reste l'alias attendu par
// pages/api/tennis/live-matches.js.
export const mapMatchToLiveState = mapLiveTennisMatch;
