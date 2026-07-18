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

function noteFor(homeSource, awaySource) {
  const sources = new Set([homeSource, awaySource]);
  if (sources.size === 1 && sources.has("classement")) {
    return "Estimation statistique (modèle de Poisson) basée sur les buts marqués/encaissés au classement — pas une IA.";
  }
  if (sources.has("forme récente") && !sources.has("estimation moyenne")) {
    return "Estimation statistique (modèle de Poisson) basée sur le classement et/ou les derniers matchs joués — pas une IA.";
  }
  return "Estimation statistique (modèle de Poisson). Classement indisponible pour au moins une équipe (ex : phase à élimination directe) : complété par une estimation moyenne — pas une IA.";
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
  const topScores = scores
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3)
    .map((s) => ({ score: s.score, probability: round1(s.probability) }));

  return {
    probabilities: { home: round1(homeWin), draw: round1(draw), away: round1(awayWin) },
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
export function computePronostic({ homeRow, awayRow, homeTeamName, awayTeamName, homeSource = "classement", awaySource = "classement" }) {
  const { lambdaHome, lambdaAway, homeUsedNeutral, awayUsedNeutral, home, away } = resolveFullMatchLambdas(homeRow, awayRow);
  const usedHomeSource = homeUsedNeutral ? "estimation moyenne" : homeSource;
  const usedAwaySource = awayUsedNeutral ? "estimation moyenne" : awaySource;

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
      over25: outcome.over25,
      under25: outcome.under25,
      bttsYes: outcome.bttsYes,
      bttsNo: outcome.bttsNo,
    },
    correctScores: outcome.topScores,
    note: noteFor(usedHomeSource, usedAwaySource),
  };
}

// Calcule le pronostic d'un match EN COURS : repart de la même force d'attaque/défense
// pré-match, mais ne projette plus que le temps de jeu restant, puis combine ça avec le
// score réel actuel — donc les probabilités évoluent avec le score et la minute de jeu,
// au lieu de rester figées sur l'estimation d'avant-match.
export function computeLivePronostic({
  homeRow, awayRow, homeTeamName, awayTeamName, homeSource = "classement", awaySource = "classement",
  currentHome, currentAway, minute,
}) {
  const { lambdaHome, lambdaAway, homeUsedNeutral, awayUsedNeutral, home, away } = resolveFullMatchLambdas(homeRow, awayRow);
  const usedHomeSource = homeUsedNeutral ? "estimation moyenne" : homeSource;
  const usedAwaySource = awayUsedNeutral ? "estimation moyenne" : awaySource;

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
      over25: outcome.over25,
      under25: outcome.under25,
      bttsYes: outcome.bttsYes,
      bttsNo: outcome.bttsNo,
    },
    correctScores: outcome.topScores,
    note: `Estimation statistique recalculée en direct (score ${offsetHome}-${offsetAway}, ${elapsed}ᵉ minute) — pas une IA.`,
  };
}
