// Bloc 4 (multi-sport, basket) — "Moments forts" : contrairement au football
// (API-Football fournit un vrai fil d'événements minute par minute, voir
// lib/apiFootball.js#getFixtureEvents/mapApiFootballEvents), API-Basketball ne fournit
// aucun play-by-play (paniers précis, sorties pour 5 fautes, temps morts) — seulement
// le score officiel (total + par quart-temps). Cette timeline reste donc TOUJOURS
// remplie (PROMPT : "ne doit JAMAIS afficher 'Événement non disponible'") avec ce qui
// est RÉELLEMENT dérivable de ce score officiel, jamais un événement inventé :
//   - coup d'envoi et fin de match (statut réel du match)
//   - fin de chaque quart-temps, avec le vrai score cumulé à ce moment
//     (game.scores.*.quarter_N — des points RÉELLEMENT marqués dans ce quart, pas une
//     estimation)
//   - changements de leader et séries de points ("runs"), détectés en comparant le
//     score actuel au dernier relevé connu — nécessite un historique des scores
//     observés PENDANT que ce match est suivi en direct (voir
//     recordSnapshotAndBuildTimeline ci-dessous, appelée à chaque actualisation de
//     pages/api/basketball/analyze.js)
// Les paniers à 3 points précis, les sorties pour fautes et les temps morts
// nécessiteraient un vrai fil d'événements minute par minute qu'aucune source
// connectée à Blume ne fournit pour le basket — volontairement absents plutôt
// qu'inventés (voir TIMELINE_LIMITATION_NOTE, exposée telle quelle côté interface).
export const TIMELINE_LIMITATION_NOTE =
  "Basé sur le score officiel (API-Basketball) : changements de leader, séries de points et fins de quart-temps. Les paniers à 3 points précis, sorties pour fautes et temps morts nécessitent un fil d'événements minute par minute que cette source ne fournit pas.";

const MAX_SNAPSHOTS_PER_GAME = 200;
// Purge un match qui n'est plus suivi par personne (plus aucun visiteur sur sa page
// depuis longtemps) — évite de faire grossir cette mémoire indéfiniment au fil des
// journées de championnat.
const SNAPSHOT_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
// Écart minimal (points), constaté entre deux relevés consécutifs SANS que l'équipe
// adverse ne marque, pour être signalé comme une "série" — en dessous, trop de bruit
// (un simple panier à 2 points ne constitue pas une série).
const RUN_THRESHOLD = 6;

const snapshotHistory = new Map(); // gameId (texte) -> { snapshots: [...], lastSeenAt }

function pruneStaleGames() {
  const now = Date.now();
  for (const [id, entry] of snapshotHistory) {
    if (now - entry.lastSeenAt > SNAPSHOT_IDLE_TTL_MS) snapshotHistory.delete(id);
  }
}

const QUARTER_KEYS = ["quarter_1", "quarter_2", "quarter_3", "quarter_4"];
const QUARTER_CODES = ["Q1", "Q2", "Q3", "Q4"];
const QUARTER_END_LABELS = { Q1: "1er quart-temps", Q2: "2ème quart-temps", Q3: "3ème quart-temps", Q4: "4ème quart-temps" };

function totalAt(game) {
  return { home: game?.scores?.home?.total ?? null, away: game?.scores?.away?.total ?? null };
}

function leaderOf(home, away) {
  if (home == null || away == null || !Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home === away) return "tied";
  return home > away ? "home" : "away";
}

// Score cumulé RÉEL à la fin du quart-temps demandé (somme des quarts réellement
// joués jusque-là) — `null` tant que ce quart-temps (ou un précédent) n'est pas encore
// terminé dans les données de la source, jamais une estimation.
function cumulativeAtQuarterEnd(game, quarterIndex) {
  let home = 0;
  let away = 0;
  for (let i = 0; i <= quarterIndex; i++) {
    const key = QUARTER_KEYS[i];
    const h = game?.scores?.home?.[key];
    const a = game?.scores?.away?.[key];
    if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
    home += h;
    away += a;
  }
  return { home, away };
}

// Enregistre le score actuel de ce match dans son historique (si différent du dernier
// relevé connu — jamais un doublon), puis reconstruit la timeline complète à partir de
// TOUT l'historique accumulé jusqu'ici. Appelée à chaque actualisation en direct
// (pages/api/basketball/analyze.js) : plus un match est suivi longtemps, plus sa
// timeline se précise — un redémarrage du serveur (mémoire non persistée, comme les
// autres caches de lib/sports/basketball/provider.js) fait simplement repartir
// l'historique des séries/changements de leader de zéro, jamais un plantage ni une
// donnée inventée pour compenser.
export function recordSnapshotAndBuildTimeline(gameId, game, { homeTeamName, awayTeamName } = {}) {
  if (!gameId || !game) return [];
  pruneStaleGames();

  const key = String(gameId);
  const now = Date.now();
  let entry = snapshotHistory.get(key);
  if (!entry) {
    entry = { snapshots: [], lastSeenAt: now };
    snapshotHistory.set(key, entry);
  }
  entry.lastSeenAt = now;

  const { home, away } = totalAt(game);
  const quarter = game?.status?.short || null;
  const clock = game?.status?.timer || null;
  if (Number.isFinite(home) && Number.isFinite(away)) {
    const last = entry.snapshots[entry.snapshots.length - 1];
    if (!last || last.home !== home || last.away !== away) {
      entry.snapshots.push({ home, away, quarter, clock, at: now });
      if (entry.snapshots.length > MAX_SNAPSHOTS_PER_GAME) entry.snapshots.shift();
    }
  }

  return buildTimelineEvents(game, entry.snapshots, { homeTeamName, awayTeamName });
}

function buildTimelineEvents(game, snapshots, { homeTeamName, awayTeamName } = {}) {
  const status = game?.status?.short;
  const hName = homeTeamName || "L'équipe à domicile";
  const aName = awayTeamName || "L'équipe à l'extérieur";
  const events = [{ id: "kickoff", kind: "KICKOFF", label: "Coup d'envoi" }];

  // Amorcé sur le tout premier relevé connu (jamais un événement "changement de
  // leader" pour ce relevé lui-même — seulement pour les transitions suivantes).
  let prevLeader = snapshots.length ? leaderOf(snapshots[0].home, snapshots[0].away) : null;
  if (prevLeader === "tied") prevLeader = null;
  let order = 0;
  QUARTER_CODES.forEach((code, qi) => {
    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i];
      if (s.quarter !== code) continue;
      const prev = snapshots[i - 1];
      if (!prev) continue;

      const leader = leaderOf(s.home, s.away);
      if (leader && leader !== "tied" && leader !== prevLeader && prevLeader != null) {
        events.push({
          id: `lead-${i}`, kind: "LEAD_CHANGE", order: order++,
          label: `Changement de leader : ${s.home} - ${s.away}`,
          quarter: code, clock: s.clock, scoreAfter: { home: s.home, away: s.away },
        });
      }
      if (leader && leader !== "tied") prevLeader = leader;

      const deltaHome = s.home - prev.home;
      const deltaAway = s.away - prev.away;
      if (deltaHome >= RUN_THRESHOLD && deltaAway === 0) {
        events.push({
          id: `run-${i}`, kind: "RUN", order: order++,
          label: `Série de ${deltaHome}-0 pour ${hName} (${s.home} - ${s.away})`,
          quarter: code, clock: s.clock, scoreAfter: { home: s.home, away: s.away },
        });
      } else if (deltaAway >= RUN_THRESHOLD && deltaHome === 0) {
        events.push({
          id: `run-${i}`, kind: "RUN", order: order++,
          label: `Série de ${deltaAway}-0 pour ${aName} (${s.home} - ${s.away})`,
          quarter: code, clock: s.clock, scoreAfter: { home: s.home, away: s.away },
        });
      }
    }

    const cum = cumulativeAtQuarterEnd(game, qi);
    if (cum) {
      events.push({
        id: `quarter-end-${qi + 1}`, kind: "QUARTER_END", order: order++,
        label: `Fin du ${QUARTER_END_LABELS[code]} : ${cum.home} - ${cum.away}`,
        quarter: code, scoreAfter: cum,
      });
    }
  });

  if (status === "FT" || status === "AOT") {
    const final = totalAt(game);
    events.push({ id: "final", kind: "FULL_TIME", order: order++, label: `Fin du match : ${final.home} - ${final.away}`, scoreAfter: final });
  }

  return events;
}

// Pour les tests : vide l'historique accumulé entre deux cas.
export function __resetTimelineHistoryForTests() {
  snapshotHistory.clear();
}
