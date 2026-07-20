import { getFixturesByDate, findLiveFixtureByTeams, getFixtureStatistics, mapFixtureStatistics } from "./apiFootball";

// Compare UNE ligne de marché ("Plus de X,5" / "Moins de X,5") au résultat réel —
// renvoie `true` (ligne atteinte), `false` (ligne ratée) ou `null` quand la donnée
// réelle nécessaire n'est pas disponible (jamais un crochet/une croix inventés).
function verifyLine(market, realValue) {
  if (!market || market.line == null || !market.side) return null;
  if (realValue == null || !Number.isFinite(realValue)) return null;
  return market.side === "Plus" ? realValue > market.line : realValue < market.line;
}

// Couple de lignes "sûre"/"risquée" (voir lib/pronostic.js, riskLines) — cartons
// jaunes/rouges : chaque niveau de risque est sa propre ligne, vérifiée séparément.
function verifyRiskLines(market, realValue) {
  return {
    safe: verifyLine(market?.safe, realValue),
    risky: verifyLine(market?.risky, realValue),
  };
}

// Bloc Corners/Hors-jeu/Fautes/Touches (voir lib/pronostic.js, buildStatBlock) : Total
// match, Total 1 (domicile), Total 2 (extérieur) — chacune sa propre ligne, vérifiée
// individuellement contre le vrai décompte final de CETTE métrique. La ligne "1ère
// mi-temps" n'a volontairement pas d'équivalent ici : aucune source ne fournit de
// décompte réel par mi-temps, elle reste donc toujours "Indisponible" côté interface.
function verifyStatBlock(block, realStat) {
  return {
    total: verifyLine(block?.total, realStat?.total),
    home: verifyLine(block?.home, realStat?.home),
    away: verifyLine(block?.away, realStat?.away),
  };
}

// Compte-rendu de fin de match, LIGNE PAR LIGNE (voir PROMPT "Probabilités réussies/
// échouées") : chaque ligne de pronostic figée est comparée individuellement au vrai
// résultat — un même match peut donc avoir des lignes vertes et d'autres rouges.
// `realStats` (voir fetchRealMatchStats ci-dessous) peut être `null` (API-Football
// indisponible ou match introuvable) : dans ce cas, seules les lignes de buts (total/
// totalHome/totalAway, dérivées du VRAI score final, toujours connu) restent
// vérifiables ; tout le reste (corners, hors-jeu, fautes, tirs, cartons) devient
// honnêtement "Indisponible", jamais un résultat inventé. Les touches (rentrées en
// jeu) ne sont, elles, JAMAIS vérifiables : aucune source (même en direct) ne les
// fournit.
export function verifyPredictionLines({ prediction, finalScore, realStats }) {
  const home = Number(finalScore?.home);
  const away = Number(finalScore?.away);
  const hasScore = Number.isFinite(home) && Number.isFinite(away);
  const markets = prediction?.markets || {};
  const matchStats = prediction?.matchStats || {};

  return {
    totalGoals: hasScore ? verifyLine(markets.totalGoals, home + away) : null,
    totalHome: hasScore ? verifyLine(markets.totalHome, home) : null,
    totalAway: hasScore ? verifyLine(markets.totalAway, away) : null,
    corners: verifyStatBlock(matchStats.corners, realStats?.corners),
    offsides: verifyStatBlock(matchStats.offsides, realStats?.offsides),
    fouls: verifyStatBlock(matchStats.fouls, realStats?.fouls),
    throwIns: { total: null, home: null, away: null },
    shots: verifyLine(markets.shots, realStats?.shots?.total),
    shotsOnTarget: verifyLine(markets.shotsOnTarget, realStats?.shotsOnTarget?.total),
    yellowCards: verifyRiskLines(markets.yellowCards, realStats?.yellowCards?.total),
    redCards: verifyRiskLines(markets.redCards, realStats?.redCards?.total),
  };
}

// Retrouve les vraies statistiques finales du match (best-effort, API-Football) — pour
// le compte-rendu de fin de match uniquement. Une fois le match terminé, il ne fait
// plus partie du flux "en direct" (getAllLiveFixtures) : on le retrouve par date +
// noms d'équipe (même mécanique que "Matchs à venir", voir getFixturesByDate), jamais
// par un id déjà connu d'avance. Renvoie `null` en silence si la clé API-Football
// n'est pas configurée, si le match n'est pas retrouvé, ou en cas d'erreur réseau —
// jamais une exception qui interromprait le compte-rendu (les lignes de buts restent
// vérifiables via le vrai score final, indépendamment de cette source).
export async function fetchRealMatchStats({ homeTeamName, awayTeamName, matchDate, apiFootballKey }) {
  if (!apiFootballKey || !homeTeamName || !awayTeamName || !matchDate) return null;
  const dateStr = String(matchDate).slice(0, 10);
  if (!dateStr) return null;

  try {
    const fixtures = await getFixturesByDate(dateStr, apiFootballKey);
    const fixture = findLiveFixtureByTeams(fixtures, homeTeamName, awayTeamName);
    if (!fixture?.fixture?.id) return null;
    const raw = await getFixtureStatistics(fixture.fixture.id, apiFootballKey);
    return mapFixtureStatistics(raw, fixture.teams?.home?.id);
  } catch (e) {
    console.error("Erreur récupération des vraies statistiques finales (API-Football):", e.message);
    return null;
  }
}
