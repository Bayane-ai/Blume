const MAX_GOALS = 6; // borne du calcul (au-delà, probabilité négligeable)

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

// Calcule le pronostic (modèle de Poisson) à partir des lignes de classement (ou, à défaut,
// de la forme récente / d'une estimation moyenne) des deux équipes. Retourne toujours un
// résultat exploitable, quel que soit le niveau de donnée disponible.
export function computePronostic({ homeRow, awayRow, homeTeamName, awayTeamName, homeSource = "classement", awaySource = "classement" }) {
  const home = homeRow && homeRow.playedGames ? homeRow : NEUTRAL_ROW;
  const away = awayRow && awayRow.playedGames ? awayRow : NEUTRAL_ROW;
  const usedHomeSource = home === NEUTRAL_ROW ? "estimation moyenne" : homeSource;
  const usedAwaySource = away === NEUTRAL_ROW ? "estimation moyenne" : awaySource;

  const homeAttack = home.goalsFor / home.playedGames;
  const homeDefense = home.goalsAgainst / home.playedGames;
  const awayAttack = away.goalsFor / away.playedGames;
  const awayDefense = away.goalsAgainst / away.playedGames;

  // Force d'attaque/défense moyennée avec l'adversaire, +avantage du terrain.
  const lambdaHome = Math.max(0.15, ((homeAttack + awayDefense) / 2) * 1.1);
  const lambdaAway = Math.max(0.15, ((awayAttack + homeDefense) / 2) * 0.95);

  const matrix = scoreMatrix(lambdaHome, lambdaAway);

  let homeWin = 0, draw = 0, awayWin = 0, over25 = 0, btts = 0;
  const scores = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = matrix[i][j];
      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
      if (i + j >= 3) over25 += p;
      if (i >= 1 && j >= 1) btts += p;
      scores.push({ score: `${i}-${j}`, probability: p });
    }
  }

  const topScores = scores
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3)
    .map((s) => ({ score: s.score, probability: round1(s.probability) }));

  return {
    available: true,
    home: { name: homeTeamName, position: home.position, points: home.points, form: home.form, source: usedHomeSource },
    away: { name: awayTeamName, position: away.position, points: away.points, form: away.form, source: usedAwaySource },
    probabilities: {
      home: round1(homeWin),
      draw: round1(draw),
      away: round1(awayWin),
    },
    goals: {
      expectedHome: Math.round(lambdaHome * 100) / 100,
      expectedAway: Math.round(lambdaAway * 100) / 100,
      over25: round1(over25),
      under25: round1(1 - over25),
      bttsYes: round1(btts),
      bttsNo: round1(1 - btts),
    },
    correctScores: topScores,
    note: noteFor(usedHomeSource, usedAwaySource),
  };
}
