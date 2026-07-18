const MAX_GOALS = 6; // borne du calcul (au-delà, probabilité négligeable)

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

// Calcule le pronostic (modèle de Poisson) à partir des lignes de classement des deux équipes.
export function computePronostic({ homeRow, awayRow, homeTeamName, awayTeamName }) {
  if (!homeRow || !awayRow || !homeRow.playedGames || !awayRow.playedGames) {
    return {
      available: false,
      message: "Classement indisponible pour cette compétition (ex : Coupe du Monde).",
    };
  }

  const homeAttack = homeRow.goalsFor / homeRow.playedGames;
  const homeDefense = homeRow.goalsAgainst / homeRow.playedGames;
  const awayAttack = awayRow.goalsFor / awayRow.playedGames;
  const awayDefense = awayRow.goalsAgainst / awayRow.playedGames;

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
    home: { name: homeTeamName, position: homeRow.position, points: homeRow.points, form: homeRow.form },
    away: { name: awayTeamName, position: awayRow.position, points: awayRow.points, form: awayRow.form },
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
    note: "Estimation statistique (modèle de Poisson) basée sur les buts marqués/encaissés au classement — pas une IA.",
  };
}
