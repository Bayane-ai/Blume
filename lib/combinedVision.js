// "Combiné Vision" — l'app génère AUTOMATIQUEMENT des combinés (tickets), l'utilisateur
// ne sélectionne rien. Chaque combiné assemble des pronostics "assez sûrs" pris sur
// PLUSIEURS matchs différents (jamais deux lignes du même match dans un même combiné),
// dans le but d'atteindre une confiance combinée plus élevée qu'un pronostic seul —
// jamais de cote chiffrée affichée (voir PROMPT), seulement les sélections détaillées
// et un niveau de confiance.
//
// Ce premier bloc pose la STRUCTURE (génération, répartition par niveau de risque,
// mention "En live") à partir des DEUX marchés qui ont déjà une vraie probabilité
// calculée par lib/pronostic.js pour CHAQUE match (probabilities 1X2, goals.over25/
// under25) — jamais une valeur inventée. Les autres statistiques mentionnées dans le
// PROMPT (corners, fautes, touches, tacles, homme du match...) rejoindront le pool de
// sélections possibles dans un bloc suivant, une fois leur calcul de fiabilité détaillé
// précisé — tacles et homme du match, en particulier, ne sont fournis par AUCUNE des
// sources déjà connectées à ce site (football-data.org, API-Football), donc aucune
// ligne ne les utilise tant qu'une vraie source n'existe pas.
const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

// En dessous de ce seuil, l'issue 1X2 la plus probable n'est pas jugée "assez sûre"
// pour entrer dans un combiné (33,3 % est le neutre à 3 issues).
const WINNER_MIN_CONFIDENCE = 45;
// Le total 2,5 buts est un marché à 2 issues (neutre à 50 %) : seuil plus élevé pour
// rester cohérent avec l'exigence "assez sûr".
const TOTAL_MIN_CONFIDENCE = 58;

// Nombre de lignes (matchs) d'un combiné → son niveau de risque affiché — plus il y a
// de lignes, plus la confiance combinée réelle (produit des probabilités, voir
// combinedConfidence) chute mécaniquement, exactement comme un vrai combiné dont la
// cote grimpe avec chaque sélection ajoutée.
export function riskLevelForLegCount(legCount) {
  if (legCount <= 2) return "faible";
  if (legCount === 3) return "moyen";
  return "eleve";
}

export const RISK_LABELS = { faible: "Peu risqué", moyen: "Moyennement risqué", eleve: "Très risqué" };

// Étiquette qualitative de confiance à partir de la vraie confiance combinée (%) —
// jamais une cote chiffrée, jamais un pourcentage arrondi à l'emporte-pièce : c'est le
// produit réel des probabilités de chaque ligne (voir combinedConfidence).
export function confidenceLabel(confidence) {
  if (confidence >= 30) return "Élevée";
  if (confidence >= 12) return "Moyenne";
  return "Faible";
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

// Meilleure ligne "assez sûre" pour CE match précis, choisie entre le 1X2 (issue la
// plus probable) et le Total 2,5 buts (Plus/Moins) — les deux seuls marchés déjà munis
// d'une vraie probabilité calculée par lib/pronostic.js. `null` si aucun des deux
// n'atteint son seuil de confiance minimum (le match n'a alors aucune ligne "assez
// sûre" à proposer, et n'entre dans aucun combiné) — jamais une ligne inventée pour
// remplir un ticket.
export function pickLegForMatch(match) {
  const p = match?.pronostic;
  if (!p || p.available === false || !p.probabilities || !p.goals) return null;

  const homeName = p.home?.name || match.homeTeam?.name || "Domicile";
  const awayName = p.away?.name || match.awayTeam?.name || "Extérieur";

  const winnerCandidates = [
    { key: "home", label: `Victoire ${homeName}`, confidence: p.probabilities.home },
    { key: "draw", label: "Match nul", confidence: p.probabilities.draw },
    { key: "away", label: `Victoire ${awayName}`, confidence: p.probabilities.away },
  ];
  const bestWinner = winnerCandidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));

  const bestTotal =
    p.goals.over25 >= p.goals.under25
      ? { label: "Plus de 2,5 buts", confidence: p.goals.over25 }
      : { label: "Moins de 2,5 buts", confidence: p.goals.under25 };

  const winnerEligible = bestWinner.confidence >= WINNER_MIN_CONFIDENCE;
  const totalEligible = bestTotal.confidence >= TOTAL_MIN_CONFIDENCE;
  if (!winnerEligible && !totalEligible) return null;

  // Entre les deux marchés éligibles, celui dont la confiance RÉELLE est la plus
  // haute — jamais un choix arbitraire.
  const chosen =
    winnerEligible && (!totalEligible || bestWinner.confidence >= bestTotal.confidence)
      ? { marketLabel: "Issue du match", pickLabel: bestWinner.label, confidence: bestWinner.confidence }
      : { marketLabel: "Total de buts", pickLabel: bestTotal.label, confidence: bestTotal.confidence };

  return {
    matchId: match.id,
    homeTeamName: homeName,
    awayTeamName: awayName,
    competitionName: match.competition?.name || "Compétition",
    isLive: LIVE_STATUSES.includes(match.status),
    match,
    comp: match.competition,
    marketLabel: chosen.marketLabel,
    pickLabel: chosen.pickLabel,
    confidence: round1(chosen.confidence),
  };
}

// Une ligne "assez sûre" par match éligible, jamais deux lignes du même match, jamais
// un match sans pronostic disponible.
export function buildLegPool(matches) {
  const seen = new Set();
  const legs = [];
  for (const m of matches || []) {
    if (!m?.id || seen.has(m.id)) continue;
    const leg = pickLegForMatch(m);
    if (leg) {
      legs.push(leg);
      seen.add(m.id);
    }
  }
  return legs;
}

// Confiance RÉELLE d'un combiné : le produit des probabilités de chaque ligne (en
// supposant l'indépendance entre matchs, comme n'importe quel calcul de combiné réel)
// — jamais une moyenne qui masquerait l'effet cumulatif du risque à mesure que des
// lignes s'ajoutent.
export function combinedConfidence(legs) {
  const product = legs.reduce((acc, leg) => acc * (leg.confidence / 100), 1);
  return round1(product * 100);
}

// Tirage aléatoire SANS remise de `count` éléments distincts de `pool` (Fisher-Yates
// partiel) — fait varier la composition des combinés d'une actualisation à l'autre,
// même si le pool de lignes éligibles n'a pas changé entre-temps.
function sampleWithoutReplacement(pool, count, random = Math.random) {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function buildCombo(legs, { isLive = false } = {}) {
  const confidence = combinedConfidence(legs);
  const riskLevel = riskLevelForLegCount(legs.length);
  const sortedIds = [...legs.map((l) => l.matchId)].sort((a, b) => a - b);
  return {
    id: `combo-${riskLevel}-${sortedIds.join("-")}-${isLive ? "live" : "prematch"}`,
    riskLevel,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    isLive,
    legs,
  };
}

// En dessous de ce nombre de lignes éligibles dans le pool, un niveau de risque donné
// n'est tout simplement pas tenté (pas assez de matchs pour l'assembler honnêtement).
const RISKY_LEG_COUNT = 4;
// Probabilité, à CHAQUE génération, de tenter un combiné "très risqué" — délibérément
// faible : "proposés rarement, pas trop souvent" (voir PROMPT), sans avoir besoin de
// mémoriser un historique des générations précédentes.
const RISKY_COMBO_CHANCE = 0.25;

// Génère les combinés à afficher, à partir des VRAIS matchs actuellement chargés
// (à venir + en direct, déjà munis chacun de leur pronostic réel — voir
// pages/api/matches.js / pages/api/live-matches.js, qui les calculent gratuitement,
// sans appel supplémentaire à l'API). Jamais de match inventé : si le pool de lignes
// "assez sûres" est trop petit, renvoie simplement moins de combinés (ou aucun),
// plutôt que d'en inventer un avec des lignes en dessous du seuil de confiance.
export function generateCombos(matches, { random = Math.random } = {}) {
  const pool = buildLegPool(matches);
  if (pool.length < 2) return [];

  const combos = [];
  const usedComboKeys = new Set(); // évite deux combinés strictement identiques (mêmes matchs)

  function tryAddCombo(legCount, { isLive = false, fromPool = pool } = {}) {
    if (fromPool.length < legCount) return false;
    const legs = sampleWithoutReplacement(fromPool, legCount, random)
      .sort((a, b) => b.confidence - a.confidence);
    const key = legs.map((l) => l.matchId).sort((a, b) => a - b).join("-");
    if (usedComboKeys.has(key)) return false;
    usedComboKeys.add(key);
    combos.push(buildCombo(legs, { isLive }));
    return true;
  }

  // Combinés peu risqués et moyennement risqués : proposés régulièrement, à chaque
  // actualisation (tant que le pool le permet).
  tryAddCombo(2);
  tryAddCombo(2);
  tryAddCombo(3);

  // Combiné très risqué (grosse cote) : rare, jamais garanti à chaque actualisation.
  if (pool.length >= RISKY_LEG_COUNT && random() < RISKY_COMBO_CHANCE) {
    tryAddCombo(Math.min(RISKY_LEG_COUNT + 1, pool.length), {});
  }

  // Combiné "En live" : uniquement si de vraies lignes en direct existent dans le pool
  // à cet instant — jamais artificiellement forcé (voir PROMPT : "parfois pendant les
  // matchs"). Mélange une ligne en direct avec, si possible, des lignes pré-match pour
  // rester un vrai combiné à plusieurs matchs.
  const livePool = pool.filter((l) => l.isLive);
  if (livePool.length > 0) {
    const legCount = Math.min(3, pool.length);
    const guaranteedLive = sampleWithoutReplacement(livePool, 1, random);
    const rest = pool.filter((l) => l.matchId !== guaranteedLive[0].matchId);
    const legs = [...guaranteedLive, ...sampleWithoutReplacement(rest, legCount - 1, random)]
      .sort((a, b) => b.confidence - a.confidence);
    const key = `live-${legs.map((l) => l.matchId).sort((a, b) => a - b).join("-")}`;
    if (!usedComboKeys.has(key)) {
      usedComboKeys.add(key);
      combos.push(buildCombo(legs, { isLive: true }));
    }
  }

  return combos;
}
