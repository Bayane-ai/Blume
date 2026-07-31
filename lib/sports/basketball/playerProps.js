// Bloc 3, point 12 — "Joueurs à suivre" (équivalent basket des buteurs probables du
// football, voir lib/probableScorers.js) : construit à partir des VRAIES statistiques
// de saison de chaque joueur (API-SPORTS Basketball, /players/statistics?team=&season=,
// voir lib/sports/basketball/provider.js#getTeamPlayerStatistics) — jamais un joueur
// inventé. Un joueur peut apparaître plusieurs fois dans la réponse brute (une ligne
// par match, selon la source) : chaque statistique est donc agrégée (somme des points/
// rebonds/passes/3 points/fautes réels, comptage des matchs) avant de calculer une
// moyenne réelle par match, jamais une valeur prise sur un seul match isolé.
import { overUnderLine } from "../../pronostic";

const MAX_PLAYERS_PER_METRIC = 3;
const DOUBLE_DOUBLE_THRESHOLD = 10;

// lib/pronostic.js#round1 convertit une FRACTION (0..1) en pourcentage — pas un
// arrondi générique. Les moyennes par joueur (points, rebonds, ...) ne sont pas des
// fractions, d'où cet arrondi à 1 décimale dédié.
function round1(x) {
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : x;
}

function toNumber(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

// Agrège les lignes brutes (une par match) en un total réel par joueur.
function aggregateByPlayer(rows) {
  const byPlayer = new Map(); // playerId -> { name, games, points, rebounds, assists, threePointers, fouls }
  for (const row of rows || []) {
    const id = row?.player?.id;
    const name = row?.player?.name;
    if (id == null || !name) continue;
    if (!byPlayer.has(id)) {
      byPlayer.set(id, { id, name, games: 0, points: 0, rebounds: 0, assists: 0, threePointers: 0, fouls: 0 });
    }
    const p = byPlayer.get(id);
    p.games += 1;
    p.points += toNumber(row.points);
    p.rebounds += toNumber(row.totReb ?? row.rebounds);
    p.assists += toNumber(row.assists);
    p.threePointers += toNumber(row.tpm ?? row.threePointersMade);
    p.fouls += toNumber(row.pFouls ?? row.fouls);
  }
  return [...byPlayer.values()].filter((p) => p.games > 0);
}

function average(total, games) {
  return games > 0 ? total / games : 0;
}

function statLine(avg, games, label) {
  return `${round1(avg)} ${label} de moyenne sur ${games} match${games > 1 ? "s" : ""} réellement joué${games > 1 ? "s" : ""} cette saison.`;
}

// Ligne "Plus de X,5" à partir de la moyenne réelle d'un joueur — même mécanique que
// les lignes d'équipe (lib/pronostic.js#overUnderLine), jamais une valeur inventée.
function playerLine(avg, games, minGames = 3) {
  if (games < minGames || avg <= 0) return null;
  return overUnderLine(avg);
}

// Construit le bloc "Joueurs à suivre" pour UNE équipe, à partir de ses vraies
// statistiques de joueurs (déjà agrégées) — jamais mélangées avec l'autre équipe.
function buildTeamPlayerProps(rows) {
  const players = aggregateByPlayer(rows);
  if (!players.length) return { topScorer: null, points: [], rebounds: [], assists: [], threePointers: [], fouls: [], doubleDoubles: [] };

  const withAverages = players.map((p) => ({
    ...p,
    avgPoints: average(p.points, p.games),
    avgRebounds: average(p.rebounds, p.games),
    avgAssists: average(p.assists, p.games),
    avgThreePointers: average(p.threePointers, p.games),
    avgFouls: average(p.fouls, p.games),
  }));

  const topScorer = [...withAverages].sort((a, b) => b.avgPoints - a.avgPoints)[0];

  function topN(key, minGames = 3) {
    return [...withAverages]
      .filter((p) => p.games >= minGames && p[key] > 0)
      .sort((a, b) => b[key] - a[key])
      .slice(0, MAX_PLAYERS_PER_METRIC)
      .map((p) => {
        const line = playerLine(p[key], p.games, minGames);
        return line ? { name: p.name, line: line.line, side: line.side, confidence: line.confidence } : null;
      })
      .filter(Boolean);
  }

  const doubleDoubles = withAverages
    .filter((p) => p.games >= 3)
    .filter((p) => {
      const stats = [p.avgPoints, p.avgRebounds, p.avgAssists];
      return stats.filter((s) => s >= DOUBLE_DOUBLE_THRESHOLD).length >= 2;
    })
    .sort((a, b) => b.avgPoints + b.avgRebounds + b.avgAssists - (a.avgPoints + a.avgRebounds + a.avgAssists))
    .slice(0, 2)
    .map((p) => ({
      name: p.name,
      justification: `${round1(p.avgPoints)} pts, ${round1(p.avgRebounds)} rbds, ${round1(p.avgAssists)} passes de moyenne sur ${p.games} matchs — double-double probable.`,
    }));

  return {
    topScorer: topScorer
      ? { name: topScorer.name, justification: statLine(topScorer.avgPoints, topScorer.games, "points") }
      : null,
    points: topN("avgPoints").map((p) => ({ ...p, justification: statLine(withAverages.find((w) => w.name === p.name).avgPoints, withAverages.find((w) => w.name === p.name).games, "points") })),
    rebounds: topN("avgRebounds").map((p) => ({ ...p, justification: statLine(withAverages.find((w) => w.name === p.name).avgRebounds, withAverages.find((w) => w.name === p.name).games, "rebonds") })),
    assists: topN("avgAssists").map((p) => ({ ...p, justification: statLine(withAverages.find((w) => w.name === p.name).avgAssists, withAverages.find((w) => w.name === p.name).games, "passes décisives") })),
    threePointers: topN("avgThreePointers").map((p) => ({ ...p, justification: statLine(withAverages.find((w) => w.name === p.name).avgThreePointers, withAverages.find((w) => w.name === p.name).games, "tirs à 3 points réussis") })),
    fouls: topN("avgFouls").map((p) => ({ ...p, justification: statLine(withAverages.find((w) => w.name === p.name).avgFouls, withAverages.find((w) => w.name === p.name).games, "fautes") })),
    doubleDoubles,
  };
}

export function buildPlayerProps({ homeRows, awayRows }) {
  return {
    home: buildTeamPlayerProps(homeRows),
    away: buildTeamPlayerProps(awayRows),
  };
}
