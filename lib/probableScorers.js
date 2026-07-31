// Construit le bloc "Buteurs probables" d'un match à partir des vrais buteurs/passeurs
// de la compétition (lib/scorersCache.js), filtrés sur les joueurs de CHAQUE équipe
// précise — jamais mélangés entre les deux équipes, jamais un joueur inventé si la
// donnée est absente. Base réelle : le total de buts/passes décisives de la SAISON en
// cours (l'API football-data.org, plan connecté au site, ne fournit pas le détail
// match par match des buteurs — seulement ce classement) ; voir le champ `basis` du
// résultat, affiché comme note honnête côté interface.
const MAX_SCORERS = 4;
const MAX_ASSISTS = 3;

// PROMPT 2 : justification chiffrée de la présence d'un joueur — construite à partir
// des SEULS champs réellement fournis par l'endpoint (buts/passes + `playedMatches`,
// le nombre de matchs joués cette saison, seul indicateur de temps de jeu disponible
// côté football-data.org). Le poste du joueur et ses minutes exactes ne sont pas
// fournis par cette API : jamais inventés ici plutôt que d'afficher une donnée fausse.
function statLine(count, playedMatches, singular, plural) {
  const base = `${count} ${count > 1 ? plural : singular}`;
  if (!Number.isFinite(playedMatches) || playedMatches <= 0) return `${base} cette saison.`;
  const rate = Math.round((count / playedMatches) * 100) / 100;
  return `${base} en ${playedMatches} match${playedMatches > 1 ? "s" : ""} joués cette saison (${String(rate).replace(".", ",")} ${singular}/match).`;
}

function buildTeamScorers(scorers, teamId) {
  const teamPlayers = (scorers || []).filter((s) => String(s.team?.id) === String(teamId));

  const topScorers = teamPlayers
    .filter((p) => (p.goals || 0) > 0)
    .sort((a, b) => (b.goals || 0) - (a.goals || 0))
    .slice(0, MAX_SCORERS)
    .map((p) => ({ name: p.player?.name, goals: p.goals || 0, justification: statLine(p.goals || 0, p.playedMatches, "but", "buts") }))
    .filter((p) => p.name);

  const topAssists = teamPlayers
    .filter((p) => (p.assists || 0) > 0)
    .sort((a, b) => (b.assists || 0) - (a.assists || 0))
    .slice(0, MAX_ASSISTS)
    .map((p) => ({ name: p.player?.name, assists: p.assists || 0, justification: statLine(p.assists || 0, p.playedMatches, "passe décisive", "passes décisives") }))
    .filter((p) => p.name);

  return { scorers: topScorers, assists: topAssists };
}

// `scorers` : réponse brute de lib/scorersCache.js (ou null si indisponible — le
// résultat reste alors exploitable, avec des listes vides pour les deux équipes,
// plutôt qu'un plantage).
export function buildProbableScorers(scorers, homeTeamId, awayTeamId) {
  return {
    home: buildTeamScorers(scorers, homeTeamId),
    away: buildTeamScorers(scorers, awayTeamId),
  };
}
