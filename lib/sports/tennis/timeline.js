// Bloc 8 (multi-sport, tennis) — "Moments forts" : comme pour le basket (voir lib/
// sports/basketball/timeline.js), aucune source connectée à Blume ne fournit de vrai
// fil d'événements point par point pour le tennis (API-Tennis expose seulement le
// score par set/par jeu, voir lib/sports/tennis/mapper.js#mapSets) — cette timeline
// reste donc TOUJOURS remplie (PROMPT : "ne doit JAMAIS afficher 'Événement non
// disponible'") avec ce qui est RÉELLEMENT dérivable de ce score par jeu, jamais un
// événement inventé :
//   - début et fin du match (statut réel du match)
//   - chaque set remporté, avec le vrai score de ce set
//   - jeu décisif (tie-break) : détecté directement sur un set terminé 7-6/6-7
//   - breaks : un jeu gagné par le joueur qui NE servait PAS au relevé précédent
//     (comparaison de deux relevés consécutifs du score par set — nécessite un
//     historique des scores observés PENDANT que ce match est suivi en direct, voir
//     recordSnapshotAndBuildTimeline ci-dessous, appelée à chaque actualisation de
//     pages/api/tennis/analyze.js)
//   - séries de jeux consécutifs (mêmes relevés, en comptant les jeux gagnés d'affilée
//     par le même joueur)
//   - balles de break sauvées : SEULE métrique de cette timeline qui ne vient pas du
//     score par jeu — dérivée d'une source de secours (PROMPT point 1 : "bascule sur
//     une source de secours"), les statistiques agrégées du match (lib/sports/tennis/
//     provider.js#getGameStatistics, balles de break gagnées par le joueur qui
//     relance — ce que l'AUTRE joueur n'a pas concédé compte comme "sauvé"), quand
//     cette source les fournit ; sinon jamais affichées plutôt qu'un chiffre inventé.
// Le score point par point AU SEIN d'un jeu (15-30-40) n'est fourni par aucune source
// connectée à Blume — volontairement absent de cette timeline plutôt qu'inventé (voir
// TIMELINE_LIMITATION_NOTE, exposée telle quelle côté interface).
export const TIMELINE_LIMITATION_NOTE =
  "Basé sur le score par set/par jeu (API-Tennis) : sets remportés, jeux décisifs, breaks (croisés avec le joueur au service au relevé précédent) et séries de jeux consécutifs. Les balles de break sauvées viennent des statistiques agrégées du match quand cette source les fournit. Le détail point par point (15-30-40) au sein d'un jeu n'est fourni par aucune source connectée à Blume.";

const MAX_SNAPSHOTS_PER_GAME = 300;
// Purge un match qui n'est plus suivi par personne — même principe que le basket.
const SNAPSHOT_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
// Nombre de jeux consécutifs gagnés par le même joueur, sans réponse de l'adversaire,
// pour être signalé comme une "série" — un simple jeu tenu au service ne constitue pas
// une série.
const RUN_THRESHOLD = 3;

const snapshotHistory = new Map(); // matchId (texte) -> { snapshots: [...], lastSeenAt }

function pruneStaleGames() {
  const now = Date.now();
  for (const [id, entry] of snapshotHistory) {
    if (now - entry.lastSeenAt > SNAPSHOT_IDLE_TTL_MS) snapshotHistory.delete(id);
  }
}

// Un set est réellement TERMINÉ à 6 (ou plus) jeux avec 2 jeux d'écart, ou à 7-6/7-5
// (jeu décisif ou break au 12e jeu) — même règle que pages/api/tennis/analyze.js#
// isSetComplete (dupliquée ici volontairement : ce fichier ne dépend d'aucun autre
// module tennis, pour rester testable en isolation comme lib/sports/basketball/
// timeline.js).
function isSetComplete(s) {
  if (s?.home == null || s?.away == null) return false;
  const diff = Math.abs(s.home - s.away);
  if (Math.max(s.home, s.away) >= 6 && diff >= 2) return true;
  if (s.home === 7 || s.away === 7) return true;
  return false;
}

function isTiebreakScore(s) {
  if (s?.home == null || s?.away == null) return false;
  return (s.home === 7 && s.away === 6) || (s.home === 6 && s.away === 7);
}

function normalizeSets(sets) {
  return Array.isArray(sets) ? sets.map((s) => ({ home: s?.home ?? null, away: s?.away ?? null })) : [];
}

// Écart (balles de break sauvées par le SERVEUR) déduit des balles de break gagnées
// par le RELANCEUR (voir lib/sports/tennis/mapper.js#mapGameStatistics,
// breakPointsWon : {value, made, attempted}) — ce que le relanceur n'a pas converti,
// le serveur l'a sauvé. `null` si la source ne fournit pas cette statistique.
function savedByServerFrom(returnerBreakPointsWon) {
  const made = returnerBreakPointsWon?.made;
  const attempted = returnerBreakPointsWon?.attempted;
  return Number.isFinite(made) && Number.isFinite(attempted) ? attempted - made : null;
}

// Enregistre le relevé actuel de ce match (score par set + joueur au service + balles
// de break sauvées si disponibles) et reconstruit la timeline complète à partir de TOUT
// l'historique accumulé jusqu'ici. Appelée à chaque actualisation en direct (pages/api/
// tennis/analyze.js) : plus un match est suivi longtemps, plus sa timeline se précise —
// un redémarrage du serveur (mémoire non persistée) fait simplement repartir
// l'historique des breaks/séries de zéro, jamais un plantage ni une donnée inventée.
// `liveMatch` : sortie de lib/sports/tennis/mapper.js#mapMatchToLiveState (sets/server/
// status). `gameStats` : sortie de mapGameStatistics(raw, homeId), ou `null` si la
// source de secours n'a rien renvoyé.
export function recordSnapshotAndBuildTimeline(matchId, liveMatch, gameStats, { homeTeamName, awayTeamName } = {}) {
  if (!matchId || !liveMatch) return [];
  pruneStaleGames();

  const key = String(matchId);
  const now = Date.now();
  let entry = snapshotHistory.get(key);
  if (!entry) {
    entry = { snapshots: [], lastSeenAt: now };
    snapshotHistory.set(key, entry);
  }
  entry.lastSeenAt = now;

  const snapshot = {
    sets: normalizeSets(liveMatch.sets),
    server: liveMatch.server || null,
    breakPointsSavedHome: savedByServerFrom(gameStats?.away?.breakPointsWon),
    breakPointsSavedAway: savedByServerFrom(gameStats?.home?.breakPointsWon),
    at: now,
  };
  const last = entry.snapshots[entry.snapshots.length - 1];
  const changed =
    !last ||
    JSON.stringify(last.sets) !== JSON.stringify(snapshot.sets) ||
    last.server !== snapshot.server ||
    last.breakPointsSavedHome !== snapshot.breakPointsSavedHome ||
    last.breakPointsSavedAway !== snapshot.breakPointsSavedAway;
  if (changed) {
    entry.snapshots.push(snapshot);
    if (entry.snapshots.length > MAX_SNAPSHOTS_PER_GAME) entry.snapshots.shift();
  }

  return buildTimelineEvents(entry.snapshots, {
    homeTeamName, awayTeamName, matchFinished: liveMatch.status === "FINISHED",
  });
}

function buildTimelineEvents(snapshots, { homeTeamName, awayTeamName, matchFinished } = {}) {
  const hName = homeTeamName || "Joueur 1";
  const aName = awayTeamName || "Joueur 2";
  const events = [{ id: "start", kind: "START", label: "Début du match" }];
  if (!snapshots.length) return events;

  let order = 0;
  let streakWinner = null;
  let streakCount = 0;
  const completedSetIndices = new Set();

  function registerGameWin(winner, si, serverAtStart, currSet) {
    if (serverAtStart && serverAtStart !== winner) {
      events.push({
        id: `break-${si}-${order}`, kind: "BREAK", order: order++,
        label: `Break pour ${winner === "home" ? hName : aName} (${currSet.home}-${currSet.away})`,
        scoreAfter: { home: currSet.home, away: currSet.away },
      });
    }
    if (streakWinner === winner) streakCount += 1;
    else { streakWinner = winner; streakCount = 1; }
    if (streakCount >= RUN_THRESHOLD && streakCount % RUN_THRESHOLD === 0) {
      events.push({
        id: `run-${si}-${order}`, kind: "RUN", order: order++,
        label: `Série de ${streakCount} jeux consécutifs pour ${winner === "home" ? hName : aName}`,
        scoreAfter: { home: currSet.home, away: currSet.away },
      });
    }
  }

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const setCount = Math.max(prev.sets.length, curr.sets.length);

    for (let si = 0; si < setCount; si++) {
      const prevSet = prev.sets[si];
      const currSet = curr.sets[si];
      if (!currSet) continue;

      if (
        prevSet && Number.isFinite(prevSet.home) && Number.isFinite(prevSet.away) &&
        Number.isFinite(currSet.home) && Number.isFinite(currSet.away)
      ) {
        const deltaHome = currSet.home - prevSet.home;
        const deltaAway = currSet.away - prevSet.away;
        if (deltaHome === 1 && deltaAway === 0) registerGameWin("home", si, prev.server, currSet);
        else if (deltaAway === 1 && deltaHome === 0) registerGameWin("away", si, prev.server, currSet);
      }

      if (!completedSetIndices.has(si) && isSetComplete(currSet)) {
        completedSetIndices.add(si);
        const winnerName = currSet.home > currSet.away ? hName : aName;
        events.push({
          id: `set-${si}`, kind: "SET_WON", order: order++,
          label: `Set ${si + 1} remporté par ${winnerName} (${currSet.home}-${currSet.away})`,
          scoreAfter: { home: currSet.home, away: currSet.away },
        });
        if (isTiebreakScore(currSet)) {
          events.push({
            id: `tb-${si}`, kind: "TIEBREAK", order: order++,
            label: `Jeu décisif dans le set ${si + 1} (${currSet.home}-${currSet.away})`,
          });
        }
      }
    }

    if (prev.breakPointsSavedHome != null && curr.breakPointsSavedHome != null) {
      const delta = curr.breakPointsSavedHome - prev.breakPointsSavedHome;
      for (let k = 0; k < delta; k++) {
        events.push({ id: `bps-home-${i}-${k}`, kind: "BREAK_POINT_SAVED", order: order++, label: `Balle de break sauvée par ${hName}` });
      }
    }
    if (prev.breakPointsSavedAway != null && curr.breakPointsSavedAway != null) {
      const delta = curr.breakPointsSavedAway - prev.breakPointsSavedAway;
      for (let k = 0; k < delta; k++) {
        events.push({ id: `bps-away-${i}-${k}`, kind: "BREAK_POINT_SAVED", order: order++, label: `Balle de break sauvée par ${aName}` });
      }
    }
  }

  if (matchFinished) {
    const lastSnap = snapshots[snapshots.length - 1];
    let home = 0;
    let away = 0;
    for (const s of lastSnap.sets) {
      if (isSetComplete(s)) {
        if (s.home > s.away) home += 1;
        else if (s.away > s.home) away += 1;
      }
    }
    events.push({ id: "final", kind: "FULL_TIME", order: order++, label: `Fin du match : ${home} set${home > 1 ? "s" : ""} à ${away}`, scoreAfter: { home, away } });
  }

  return events;
}

// Pour les tests : vide l'historique accumulé entre deux cas.
export function __resetTimelineHistoryForTests() {
  snapshotHistory.clear();
}
