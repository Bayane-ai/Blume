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

// Ligne de marché façon paris sportifs ("Plus de 2,5" / "Moins de 2,5") à partir d'une
// estimation réelle (buts attendus, corners, cartons...) pour CE match précis — jamais
// une cote (pas de 1.85/2.40), seulement la ligne et le sens. La ligne est toujours à
// virgule (X.5, jamais un nombre entier) : elle varie naturellement d'un match à
// l'autre selon les vraies stats des deux équipes — un match très offensif place la
// ligne plus haut (ex : 3.5) qu'un match fermé (ex : 1.5), au lieu d'une valeur fixe
// recopiée partout.
function overUnderLine(expected, minLine = 0.5) {
  const value = Math.max(0, expected || 0);
  const line = Math.max(minLine, Math.floor(value) + 0.5);
  const side = value > line ? "Plus" : "Moins";
  return { line, side };
}

// Convertit une estimation ponctuelle (nombre de buts attendu, corners...) en
// intervalle affichable ("entre 2 et 3", "environ 8-10") plutôt qu'un pourcentage —
// voir PROMPT "pronostics sans pourcentage hors 1X2". L'écart est dérivé de la vraie
// variance du modèle (racine du nombre de buts attendu, pour une somme de lois de
// Poisson) : plus la rencontre est incertaine/ouverte, plus l'intervalle est large,
// jamais une largeur fixe recopiée partout.
function rangeFromVariance(point, varianceBase) {
  const spread = Math.sqrt(Math.max(0, varianceBase));
  const low = Math.max(0, Math.round(point - spread));
  let high = Math.round(point + spread);
  if (high <= low) high = low + 1;
  return { low, high };
}

// Même principe pour les stats sans modèle de variance dédié (corners/tirs/cartons,
// dérivés d'une moyenne de championnat répartie par intensité offensive) : un écart
// proportionnel à l'estimation elle-même, jamais identique d'un match à l'autre.
function rangeFromShare(point) {
  const spread = Math.max(1, Math.round(point * 0.2));
  return { low: Math.max(0, point - spread), high: point + spread };
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

// Un match très ouvert (beaucoup de buts attendus des deux côtés) n'a pas la même
// lecture qu'un match fermé — dérivé du nombre de buts attendu de CE match précis,
// jamais une formule fixe.
function matchProfileLabel(expectedTotal) {
  if (expectedTotal >= 3.2) return "match très offensif";
  if (expectedTotal >= 2.4) return "match ouvert";
  if (expectedTotal >= 1.6) return "match équilibré";
  return "match fermé";
}

// Résume qui domine réellement CE match (ou si c'est vraiment indécis), à partir des
// probabilités déjà calculées et des noms des deux équipes — pour que le texte
// d'analyse dise concrètement quelque chose de spécifique à ce match, jamais la même
// phrase générique recopiée sur tous les matchs.
function favoriteSummary(probabilities, homeTeamName, awayTeamName) {
  const { home, away } = probabilities;
  const margin = Math.abs(home - away);
  const home_ = homeTeamName || "l'équipe à domicile";
  const away_ = awayTeamName || "l'équipe à l'extérieur";

  if (margin < 8) return "issue très incertaine, aucun favori net";
  const favorite = home > away ? home_ : away_;
  if (margin >= 45) return `${favorite} très largement favori(te)`;
  if (margin >= 20) return `${favorite} nettement favori(te)`;
  return `${favorite} légèrement favori(te)`;
}

function noteFor({ homeSource, awaySource, h2hUsed = false, probabilities, expectedTotal, homeTeamName, awayTeamName }) {
  const sources = new Set([homeSource, awaySource]);
  const h2hSuffix = h2hUsed ? " Affiné avec les confrontations directes récentes entre ces deux équipes." : "";
  const roundedTotal = Math.round(expectedTotal * 10) / 10;
  const summary = ` ${favoriteSummary(probabilities, homeTeamName, awayTeamName)}, ${matchProfileLabel(expectedTotal)} attendu (~${roundedTotal} but${roundedTotal >= 2 ? "s" : ""}).`;

  let base;
  if (sources.size === 1 && sources.has("classement")) {
    base = "Estimation statistique (modèle de Poisson) basée sur les buts marqués/encaissés au classement";
  } else if (sources.has("forme récente") && !sources.has("estimation moyenne")) {
    base = "Estimation statistique (modèle de Poisson) basée sur le classement et/ou les derniers matchs joués";
  } else {
    base = "Estimation statistique (modèle de Poisson). Classement indisponible pour au moins une équipe (ex : phase à élimination directe) : complété par une estimation moyenne";
  }
  return `${base} — pas une IA.${summary}${h2hSuffix}`;
}

// En dessous de ce nombre de matchs à un lieu précis (domicile pour l'équipe qui
// reçoit, extérieur pour celle qui se déplace) dans l'historique récent, la moyenne à
// ce lieu est trop bruitée pour être fiable (un ou deux matchs isolés peuvent la
// faire varier énormément) : on retombe alors sur la moyenne globale de l'équipe
// (tous lieux confondus), ajustée d'un facteur d'avantage du terrain générique — même
// seuil de prudence que pour les confrontations directes (H2H_MIN_MATCHES).
const VENUE_SPLIT_MIN_MATCHES = 3;
const GENERIC_HOME_ADVANTAGE = 1.1;
const GENERIC_AWAY_DISADVANTAGE = 0.95;

// Force d'attaque/défense d'une équipe à UN lieu précis : ses propres matchs récents
// joués à ce lieu (voir lib/teamForm.js, qui calcule déjà cette répartition à partir
// des mêmes matchs récents, sans appel API supplémentaire) quand l'échantillon est
// assez grand — jamais une moyenne mélangeant domicile et extérieur, qui gommerait le
// vrai profil de l'équipe selon où CE match précis se joue.
function attackDefenseAtVenue(row, venue) {
  const played = venue === "home" ? row.homePlayedGames : row.awayPlayedGames;
  if (played >= VENUE_SPLIT_MIN_MATCHES) {
    const goalsFor = venue === "home" ? row.homeGoalsFor : row.awayGoalsFor;
    const goalsAgainst = venue === "home" ? row.homeGoalsAgainst : row.awayGoalsAgainst;
    return { attack: goalsFor / played, defense: goalsAgainst / played, usedVenueSplit: true };
  }
  return { attack: row.goalsFor / row.playedGames, defense: row.goalsAgainst / row.playedGames, usedVenueSplit: false };
}

// Force d'attaque/défense moyennée avec l'adversaire, pour tout le match. Utilise en
// priorité la vraie moyenne de CHAQUE équipe À CE LIEU précis (domicile pour l'équipe
// qui reçoit, extérieur pour celle qui se déplace) quand l'historique récent en
// contient assez — le facteur d'avantage du terrain générique (fixe) ne sert plus que
// de repli quand cette répartition réelle n'est pas exploitable (classement seul, ou
// trop peu de matchs à ce lieu dans l'historique récent).
function resolveFullMatchLambdas(homeRow, awayRow) {
  const home = homeRow && homeRow.playedGames ? homeRow : NEUTRAL_ROW;
  const away = awayRow && awayRow.playedGames ? awayRow : NEUTRAL_ROW;

  const homeAtVenue = attackDefenseAtVenue(home, "home");
  const awayAtVenue = attackDefenseAtVenue(away, "away");

  const homeAdvantage = homeAtVenue.usedVenueSplit ? 1 : GENERIC_HOME_ADVANTAGE;
  const awayAdvantage = awayAtVenue.usedVenueSplit ? 1 : GENERIC_AWAY_DISADVANTAGE;

  const lambdaHome = Math.max(0.15, ((homeAtVenue.attack + awayAtVenue.defense) / 2) * homeAdvantage);
  const lambdaAway = Math.max(0.15, ((awayAtVenue.attack + homeAtVenue.defense) / 2) * awayAdvantage);

  return {
    lambdaHome,
    lambdaAway,
    homeUsedNeutral: home === NEUTRAL_ROW,
    awayUsedNeutral: away === NEUTRAL_ROW,
    homeUsedVenueSplit: homeAtVenue.usedVenueSplit,
    awayUsedVenueSplit: awayAtVenue.usedVenueSplit,
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
// attendue de CE match précis, calées sur des moyennes observées en football
// professionnel — pas une mesure réelle du match.
const AVG_CORNERS_TOTAL = 10.5;
const AVG_SHOTS_TOTAL = 24;
const AVG_CARDS_TOTAL = 4.4;
// Total de buts attendu "moyen" auquel ces moyennes de championnat correspondent —
// sert à faire varier les TOTAUX (pas seulement la répartition domicile/extérieur)
// selon que CE match est plus ou moins offensif qu'un match moyen. Sans ce facteur,
// le total de corners/tirs/cartons restait quasiment identique d'un match à l'autre
// (seule la répartition domicile/extérieur changeait) : deux rencontres très
// différentes (une démonstration offensive, un match fermé) affichaient presque le
// même nombre de tirs — corrigé ici pour que l'intensité réelle de chaque match se
// reflète aussi sur ces totaux.
const BASELINE_TOTAL_GOALS = 2.6;
function intensityFactor(totalGoalsExpected) {
  return Math.min(1.8, Math.max(0.5, totalGoalsExpected / BASELINE_TOTAL_GOALS));
}

function estimateMatchStats(lambdaHome, lambdaAway) {
  const total = lambdaHome + lambdaAway;
  const homeShare = total > 0 ? lambdaHome / total : 0.5;
  const awayShare = 1 - homeShare;
  const factor = intensityFactor(total);

  // Valeurs brutes (non arrondies) conservées pour calculer les lignes de marché
  // (overUnderLine) : arrondir d'abord à l'entier écraserait une partie de la vraie
  // variation d'un match à l'autre, faisant retomber deux matchs proches sur la même ligne.
  const cornersTotalRaw = Math.max(4, AVG_CORNERS_TOTAL * factor);
  const shotsTotalRaw = Math.max(6, AVG_SHOTS_TOTAL * factor);
  const cardsTotalRaw = Math.max(1, AVG_CARDS_TOTAL * factor);

  const cornersTotal = Math.round(cornersTotalRaw);
  const shotsTotal = Math.round(shotsTotalRaw);
  const cardsTotal = Math.round(cardsTotalRaw);

  const cornersHome = Math.round(cornersTotal * homeShare);
  const cornersAway = cornersTotal - cornersHome;
  const shotsHome = Math.round(shotsTotal * homeShare);
  const shotsAway = shotsTotal - shotsHome;
  // Cartons : l'équipe qui défend face à l'intensité offensive la plus forte de
  // l'adversaire commet statistiquement un peu plus de fautes.
  const cardsHome = Math.round(cardsTotal * awayShare);
  const cardsAway = cardsTotal - cardsHome;
  // Possession estimée à partir de la même intensité offensive relative, resserrée
  // autour de 50/50 (bornes 30-70 : la possession varie moins d'un match à l'autre
  // que les tirs/corners en football professionnel) — comme les autres stats de ce
  // bloc, jamais une mesure réelle (non fournie par l'API), toujours dérivée du
  // profil des deux équipes de CE match précis.
  const possessionHome = Math.min(70, Math.max(30, Math.round(50 + (homeShare - 0.5) * 60)));
  const possessionAway = 100 - possessionHome;

  return {
    corners: { home: cornersHome, away: cornersAway, total: cornersTotal, range: rangeFromShare(cornersTotal) },
    shots: { home: shotsHome, away: shotsAway, total: shotsTotal, range: rangeFromShare(shotsTotal) },
    cards: { home: cardsHome, away: cardsAway, total: cardsTotal, range: rangeFromShare(cardsTotal) },
    possession: { home: possessionHome, away: possessionAway },
    raw: { cornersTotal: cornersTotalRaw, shotsTotal: shotsTotalRaw, cardsTotal: cardsTotalRaw },
  };
}

// Les lignes de marché façon paris sportifs demandées pour le bloc de pronostics
// (voir components/PronosticResults.js) : total du match, total de chaque équipe
// séparément (jamais mélangés), corners, tirs, cartons — chacune dérivée des vraies
// stats de CE match (buts attendus par équipe, intensité offensive), jamais une
// valeur fixe.
function buildMarkets({ totalHomeGoals, totalAwayGoals, extraStats }) {
  return {
    totalGoals: overUnderLine(totalHomeGoals + totalAwayGoals),
    totalHome: overUnderLine(totalHomeGoals),
    totalAway: overUnderLine(totalAwayGoals),
    corners: overUnderLine(extraStats.raw.cornersTotal),
    shots: overUnderLine(extraStats.raw.shotsTotal),
    cards: overUnderLine(extraStats.raw.cardsTotal),
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
  const extraStats = estimateMatchStats(lambdaHome, lambdaAway);

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
      range: rangeFromVariance(lambdaHome + lambdaAway, lambdaHome + lambdaAway),
      over25: outcome.over25,
      under25: outcome.under25,
      bttsYes: outcome.bttsYes,
      bttsNo: outcome.bttsNo,
    },
    correctScores: outcome.topScores,
    extraStats,
    markets: buildMarkets({ totalHomeGoals: lambdaHome, totalAwayGoals: lambdaAway, extraStats }),
    h2hUsed,
    statsNote: STATS_NOTE,
    note: noteFor({
      homeSource: usedHomeSource, awaySource: usedAwaySource, h2hUsed,
      probabilities: outcome.probabilities, expectedTotal: lambdaHome + lambdaAway,
      homeTeamName, awayTeamName,
    }),
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
  // Corners/cartons sont estimés pour le match ENTIER (comme avant), pas seulement le
  // temps restant — un carton ou un corner déjà survenu compte autant qu'un à venir.
  const extraStats = estimateMatchStats(lambdaHome, lambdaAway);
  // Les totaux de buts par équipe, eux, doivent refléter la projection sur le match
  // ENTIER (déjà marqués + temps restant), pas seulement les buts encore à venir —
  // sinon "Total 1"/"Total 2" ignoreraient les buts déjà inscrits au tableau d'affichage.
  const finalHomeGoals = offsetHome + lambdaHomeRemaining;
  const finalAwayGoals = offsetAway + lambdaAwayRemaining;

  return {
    available: true,
    live: true,
    minute: elapsed,
    currentScore: { home: offsetHome, away: offsetAway },
    home: { name: homeTeamName, position: home.position, points: home.points, form: home.form, source: usedHomeSource },
    away: { name: awayTeamName, position: away.position, points: away.points, form: away.form, source: usedAwaySource },
    probabilities: outcome.probabilities,
    goals: {
      expectedHome: round2(finalHomeGoals),
      expectedAway: round2(finalAwayGoals),
      expectedTotal: round2(finalHomeGoals + finalAwayGoals),
      // La variance ne porte que sur les buts restant à jouer (aléatoires) : les buts
      // déjà marqués sont un fait acquis, pas une source d'incertitude.
      range: rangeFromVariance(
        finalHomeGoals + finalAwayGoals,
        lambdaHomeRemaining + lambdaAwayRemaining
      ),
      over25: outcome.over25,
      under25: outcome.under25,
      bttsYes: outcome.bttsYes,
      bttsNo: outcome.bttsNo,
    },
    correctScores: outcome.topScores,
    extraStats,
    markets: buildMarkets({ totalHomeGoals: finalHomeGoals, totalAwayGoals: finalAwayGoals, extraStats }),
    h2hUsed,
    statsNote: STATS_NOTE,
    note: `Estimation statistique recalculée en direct (score ${offsetHome}-${offsetAway}, ${elapsed}ᵉ minute) — pas une IA. ${favoriteSummary(outcome.probabilities, homeTeamName, awayTeamName)} pour la suite du match.${h2hUsed ? " Affiné avec les confrontations directes récentes entre ces deux équipes." : ""}`,
  };
}
