const MAX_GOALS = 6; // borne du calcul (au-delà, probabilité négligeable)
const MATCH_MINUTES = 90;

// Force par défaut utilisée quand aucune donnée (classement ni forme récente) n'est
// disponible pour une équipe : une équipe "moyenne" (~1,3 but marqué/encaissé par match),
// pour que le pronostic reste exploitable dans tous les cas plutôt que de ne rien afficher.
const NEUTRAL_ROW = { playedGames: 10, goalsFor: 13, goalsAgainst: 13, position: null, points: null, form: null };

function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function poissonP(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

// Matrice des probabilités but domicile (i) x but extérieur (j), en supposant l'indépendance.
function scoreMatrix(lambdaHome, lambdaAway) {
  const homeProbs = Array.from({ length: MAX_GOALS + 1 }, (_, k) => poissonP(k, lambdaHome));
  const awayProbs = Array.from({ length: MAX_GOALS + 1 }, (_, k) => poissonP(k, lambdaAway));
  const matrix = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    const row = [];
    for (let j = 0; j <= MAX_GOALS; j++) row.push(homeProbs[i] * awayProbs[j]);
    matrix.push(row);
  }
  return matrix;
}

function round1(x) {
  return Math.round(x * 1000) / 10;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// Le nombre de buts simulé est borné (MAX_GOALS) : une petite masse de probabilité
// au-delà (surtout pour deux équipes très offensives) est ignorée par le calcul, donc
// domicile+nul+extérieur peut tomber un peu sous 100 % avant cette étape. On
// renormalise sur 100, puis on distribue les dixièmes de pourcent restants après
// arrondi à la valeur qui en a le plus perdu (méthode du plus grand reste) : le total
// affiché est donc toujours exactement 100,0 %, jamais 97 % ou 101 %.
function normalizeProbabilitiesToHundred(rawFractions) {
  const total = rawFractions.home + rawFractions.draw + rawFractions.away;
  const scale = total > 0 ? 100 / total : 0;
  const scaled = {
    home: rawFractions.home * scale,
    draw: rawFractions.draw * scale,
    away: rawFractions.away * scale,
  };

  const keys = Object.keys(scaled);
  const floored = {};
  let flooredSum = 0;
  const fracs = keys.map((k) => {
    const tenths = Math.floor(scaled[k] * 10);
    floored[k] = tenths / 10;
    flooredSum += floored[k];
    return { k, frac: scaled[k] * 10 - tenths };
  });
  fracs.sort((a, b) => b.frac - a.frac);

  const result = { ...floored };
  let remainingTenths = Math.round((100 - flooredSum) * 10);
  for (let i = 0; i < remainingTenths && i < fracs.length; i++) {
    result[fracs[i].k] = Math.round((result[fracs[i].k] + 0.1) * 10) / 10;
  }
  return result;
}

function noteFor(homeSource, awaySource, h2hUsed = false) {
  const sources = new Set([homeSource, awaySource]);
  const h2hSuffix = h2hUsed ? " Affiné avec les confrontations directes récentes entre ces deux équipes." : "";
  if (sources.size === 1 && sources.has("classement")) {
    return `Estimation statistique (modèle de Poisson) basée sur les buts marqués/encaissés au classement — pas une IA.${h2hSuffix}`;
  }
  if (sources.has("forme récente") && !sources.has("estimation moyenne")) {
    return `Estimation statistique (modèle de Poisson) basée sur le classement et/ou les derniers matchs joués — pas une IA.${h2hSuffix}`;
  }
  return `Estimation statistique (modèle de Poisson). Classement indisponible pour au moins une équipe (ex : phase à élimination directe) : complété par une estimation moyenne — pas une IA.${h2hSuffix}`;
}

// Force d'attaque/défense moyennée avec l'adversaire, +avantage du terrain, pour tout le match.
function resolveFullMatchLambdas(homeRow, awayRow) {
  const home = homeRow && homeRow.playedGames ? homeRow : NEUTRAL_ROW;
  const away = awayRow && awayRow.playedGames ? awayRow : NEUTRAL_ROW;

  const homeAttack = home.goalsFor / home.playedGames;
  const homeDefense = home.goalsAgainst / home.playedGames;
  const awayAttack = away.goalsFor / away.playedGames;
  const awayDefense = away.goalsAgainst / away.playedGames;

  const lambdaHome = Math.max(0.15, ((homeAttack + awayDefense) / 2) * 1.1);
  const lambdaAway = Math.max(0.15, ((awayAttack + homeDefense) / 2) * 0.95);

  return {
    lambdaHome,
    lambdaAway,
    homeUsedNeutral: home === NEUTRAL_ROW,
    awayUsedNeutral: away === NEUTRAL_ROW,
    home,
    away,
  };
}

// En dessous de 3 confrontations directes connues, l'échantillon est trop petit pour
// influencer le pronostic de façon fiable : on ignore l'historique plutôt que de le
// laisser peser sur un ou deux résultats isolés.
const H2H_MIN_MATCHES = 3;
// Poids de l'historique direct dans le nombre de buts attendu, et dans la répartition
// domicile/extérieur — volontairement minoritaire : le classement/la forme récente de
// CETTE saison restent le signal principal, les confrontations directes (souvent
// anciennes) ne font qu'ajuster à la marge.
const H2H_GOALS_WEIGHT = 0.2;
const H2H_SPLIT_WEIGHT = 0.15;

// Affine les buts attendus (pré-calculés à partir du classement/forme récente) avec
// les vraies confrontations directes entre CES deux équipes précises, quand l'API en
// fournit assez (lib/headToHead.js, /matches/{id}/head2head) — jamais de valeur
// inventée : sans historique exploitable, les lambdas du classement sont utilisés tels quels.
function applyHeadToHead(lambdaHome, lambdaAway, h2h) {
  if (!h2h || !h2h.numberOfMatches || h2h.numberOfMatches < H2H_MIN_MATCHES) {
    return { lambdaHome, lambdaAway, used: false };
  }

  const total = lambdaHome + lambdaAway;
  const splitHome = total > 0 ? lambdaHome / total : 0.5;

  const h2hAvgGoals = h2h.totalGoals / h2h.numberOfMatches;
  const blendedTotal = total * (1 - H2H_GOALS_WEIGHT) + h2hAvgGoals * H2H_GOALS_WEIGHT;

  const h2hHomeRate = h2h.homeWins / h2h.numberOfMatches;
  const h2hAwayRate = h2h.awayWins / h2h.numberOfMatches;
  const dominance = h2hHomeRate - h2hAwayRate; // -1 (l'extérieur domine l'historique) .. +1 (le domicile domine)
  const adjustedSplitHome = Math.min(0.85, Math.max(0.15, splitHome + dominance * H2H_SPLIT_WEIGHT));

  return {
    lambdaHome: Math.max(0.15, blendedTotal * adjustedSplitHome),
    lambdaAway: Math.max(0.15, blendedTotal * (1 - adjustedSplitHome)),
    used: true,
  };
}

// Corners, tirs et cartons ne sont pas fournis par l'API football-data.org (plan
// gratuit) : ce sont des estimations statistiques dérivées de l'intensité offensive
// attendue de chaque équipe (lambda domicile/extérieur), calées sur des moyennes
// observées en football professionnel — pas une mesure réelle du match.
const AVG_CORNERS_TOTAL = 10.5;
const AVG_SHOTS_TOTAL = 24;
const AVG_CARDS_TOTAL = 4.4;

function estimateMatchStats(lambdaHome, lambdaAway) {
  const total = lambdaHome + lambdaAway;
  const homeShare = total > 0 ? lambdaHome / total : 0.5;
  const awayShare = 1 - homeShare;

  const cornersHome = Math.round(AVG_CORNERS_TOTAL * homeShare);
  const cornersAway = Math.round(AVG_CORNERS_TOTAL * awayShare);
  const shotsHome = Math.round(AVG_SHOTS_TOTAL * homeShare);
  const shotsAway = Math.round(AVG_SHOTS_TOTAL * awayShare);
  // Cartons : l'équipe qui défend face à l'intensité offensive la plus forte de
  // l'adversaire commet statistiquement un peu plus de fautes.
  const cardsHome = Math.round(AVG_CARDS_TOTAL * awayShare);
  const cardsAway = Math.round(AVG_CARDS_TOTAL * homeShare);
  // Possession estimée à partir de la même intensité offensive relative, resserrée
  // autour de 50/50 (bornes 30-70 : la possession varie moins d'un match à l'autre
  // que les tirs/corners en football professionnel) — comme les autres stats de ce
  // bloc, jamais une mesure réelle (non fournie par l'API), toujours dérivée du
  // profil des deux équipes de CE match précis.
  const possessionHome = Math.min(70, Math.max(30, Math.round(50 + (homeShare - 0.5) * 60)));
  const possessionAway = 100 - possessionHome;

  return {
    corners: { home: cornersHome, away: cornersAway, total: cornersHome + cornersAway },
    shots: { home: shotsHome, away: shotsAway, total: shotsHome + shotsAway },
    cards: { home: cardsHome, away: cardsAway, total: cardsHome + cardsAway },
    possession: { home: possessionHome, away: possessionAway },
  };
}

const STATS_NOTE =
  "Corners, tirs, cartons et possession ne sont pas fournis par l'API (plan gratuit) : ce sont des estimations statistiques basées sur l'intensité offensive attendue de chaque équipe, pas une mesure réelle du match.";

const CORRECT_SCORES_MIN = 3;
const CORRECT_SCORES_MAX = 6;
const CORRECT_SCORES_RELATIVE_THRESHOLD = 0.35;

// Ne fige pas le nombre de scores à 3 : selon le profil de chaque équipe (attaque/
// défense réelle), une confrontation ouverte (deux équipes qui marquent beaucoup)
// a une distribution de buts plus étalée et fait naturellement remonter des scores
// plus élevés dans la sélection, alors qu'une confrontation fermée reste groupée sur
// des petits scores — au lieu d'un simple "top 3" toujours dominé par les mêmes
// scores faibles quelle que soit l'équipe.
function selectCorrectScores(scores) {
  const sorted = [...scores].sort((a, b) => b.probability - a.probability);
  const topProbability = sorted[0]?.probability || 0;
  const selected = sorted.filter((s, idx) => {
    if (idx < CORRECT_SCORES_MIN) return true;
    if (idx >= CORRECT_SCORES_MAX) return false;
    return s.probability >= topProbability * CORRECT_SCORES_RELATIVE_THRESHOLD;
  });
  return selected.map((s) => ({ score: s.score, probability: round1(s.probability) }));
}

function buildOutcome({ matrix, offsetHome = 0, offsetAway = 0 }) {
  let homeWin = 0, draw = 0, awayWin = 0, over25 = 0, btts = 0;
  const scores = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = matrix[i][j];
      const finalHome = offsetHome + i;
      const finalAway = offsetAway + j;
      if (finalHome > finalAway) homeWin += p;
      else if (finalHome === finalAway) draw += p;
      else awayWin += p;
      if (finalHome + finalAway >= 3) over25 += p;
      if (finalHome >= 1 && finalAway >= 1) btts += p;
      scores.push({ score: `${finalHome}-${finalAway}`, probability: p });
    }
  }
  const topScores = selectCorrectScores(scores);

  return {
    probabilities: normalizeProbabilitiesToHundred({ home: homeWin, draw, away: awayWin }),
    over25: round1(over25),
    under25: round1(1 - over25),
    bttsYes: round1(btts),
    bttsNo: round1(1 - btts),
    topScores,
  };
}

// Calcule le pronostic pré-match (modèle de Poisson) à partir des lignes de classement
// (ou, à défaut, de la forme récente / d'une estimation moyenne) des deux équipes.
// Retourne toujours un résultat exploitable, quel que soit le niveau de donnée disponible.
export function computePronostic({ homeRow, awayRow, homeTeamName, awayTeamName, homeSource = "classement", awaySource = "classement", h2h = null }) {
  const resolved = resolveFullMatchLambdas(homeRow, awayRow);
  const { homeUsedNeutral, awayUsedNeutral, home, away } = resolved;
  const usedHomeSource = homeUsedNeutral ? "estimation moyenne" : homeSource;
  const usedAwaySource = awayUsedNeutral ? "estimation moyenne" : awaySource;

  const { lambdaHome, lambdaAway, used: h2hUsed } = applyHeadToHead(resolved.lambdaHome, resolved.lambdaAway, h2h);

  const matrix = scoreMatrix(lambdaHome, lambdaAway);
  const outcome = buildOutcome({ matrix });

  return {
    available: true,
    live: false,
    home: { name: homeTeamName, position: home.position, points: home.points, form: home.form, source: usedHomeSource },
    away: { name: awayTeamName, position: away.position, points: away.points, form: away.form, source: usedAwaySource },
    probabilities: outcome.probabilities,
    goals: {
      expectedHome: round2(lambdaHome),
      expectedAway: round2(lambdaAway),
      expectedTotal: round2(lambdaHome + lambdaAway),
      over25: outcome.over25,
      under25: outcome.under25,
      bttsYes: outcome.bttsYes,
      bttsNo: outcome.bttsNo,
    },
    correctScores: outcome.topScores,
    extraStats: estimateMatchStats(lambdaHome, lambdaAway),
    h2hUsed,
    statsNote: STATS_NOTE,
    note: noteFor(usedHomeSource, usedAwaySource, h2hUsed),
  };
}

// Calcule le pronostic d'un match EN COURS : repart de la même force d'attaque/défense
// pré-match, mais ne projette plus que le temps de jeu restant, puis combine ça avec le
// score réel actuel — donc les probabilités évoluent avec le score et la minute de jeu,
// au lieu de rester figées sur l'estimation d'avant-match.
export function computeLivePronostic({
  homeRow, awayRow, homeTeamName, awayTeamName, homeSource = "classement", awaySource = "classement",
  currentHome, currentAway, minute, h2h = null,
}) {
  const resolved = resolveFullMatchLambdas(homeRow, awayRow);
  const { homeUsedNeutral, awayUsedNeutral, home, away } = resolved;
  const usedHomeSource = homeUsedNeutral ? "estimation moyenne" : homeSource;
  const usedAwaySource = awayUsedNeutral ? "estimation moyenne" : awaySource;

  const { lambdaHome, lambdaAway, used: h2hUsed } = applyHeadToHead(resolved.lambdaHome, resolved.lambdaAway, h2h);

  const elapsed = Math.min(MATCH_MINUTES, Math.max(0, minute || 0));
  const remainingFraction = Math.max(0, (MATCH_MINUTES - elapsed) / MATCH_MINUTES);
  const lambdaHomeRemaining = lambdaHome * remainingFraction;
  const lambdaAwayRemaining = lambdaAway * remainingFraction;

  const offsetHome = Math.max(0, currentHome || 0);
  const offsetAway = Math.max(0, currentAway || 0);

  const matrix = scoreMatrix(lambdaHomeRemaining, lambdaAwayRemaining);
  const outcome = buildOutcome({ matrix, offsetHome, offsetAway });

  return {
    available: true,
    live: true,
    minute: elapsed,
    currentScore: { home: offsetHome, away: offsetAway },
    home: { name: homeTeamName, position: home.position, points: home.points, form: home.form, source: usedHomeSource },
    away: { name: awayTeamName, position: away.position, points: away.points, form: away.form, source: usedAwaySource },
    probabilities: outcome.probabilities,
    goals: {
      expectedHome: round2(offsetHome + lambdaHomeRemaining),
      expectedAway: round2(offsetAway + lambdaAwayRemaining),
      expectedTotal: round2(offsetHome + offsetAway + lambdaHomeRemaining + lambdaAwayRemaining),
      over25: outcome.over25,
      under25: outcome.under25,
      bttsYes: outcome.bttsYes,
      bttsNo: outcome.bttsNo,
    },
    correctScores: outcome.topScores,
    extraStats: estimateMatchStats(lambdaHome, lambdaAway),
    h2hUsed,
    statsNote: STATS_NOTE,
    note: `Estimation statistique recalculée en direct (score ${offsetHome}-${offsetAway}, ${elapsed}ᵉ minute) — pas une IA.${h2hUsed ? " Affiné avec les confrontations directes récentes entre ces deux équipes." : ""}`,
  };
}
