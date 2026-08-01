// Bloc 7 (pronostics tennis) — modèle mathématique du match, indépendant de toute
// donnée API (fonctions pures, testables isolément). Le football utilise une loi de
// Poisson sur les buts (lib/pronostic.js) et le basket une approximation normale sur
// les points (lib/sports/basketball/normalDist.js) — aucun des deux ne convient au
// tennis, qui se joue point par point à l'intérieur de jeux, sets puis match (une
// vraie chaîne de Markov emboîtée, pas un simple total à estimer). Ce fichier calcule
// donc, à partir de la seule probabilité qu'un joueur gagne un point sur SON service
// (dérivée des vraies statistiques de service/retour de chaque joueur, voir
// lib/sports/tennis/statProfiles.js), la probabilité de gagner un jeu, un set puis le
// match, ainsi que les grandeurs dérivées (jeux attendus, probabilité d'atteindre un
// jeu décisif, nombre de breaks attendu) — un calcul RÉEL, pas une estimation
// arbitraire, à partir des règles effectives du tennis.

function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

// Probabilité de gagner une "course" à `target` points avec au moins `winBy` points
// d'écart (ex : un jeu = course à 4 points, écart de 2 ; un jeu décisif = course à 7
// points, écart de 2), à partir de la probabilité `p` de gagner CHAQUE point — la
// même formule couvre donc le jeu ET le jeu décisif, jamais deux calculs différents
// qui pourraient diverger. Au-delà de l'égalité qui impose l'écart de 2 (ex : 3-3 dans
// un jeu, 6-6 dans un jeu décisif), la probabilité de finir par gagner à partir d'une
// égalité est une constante connue (p²/(p²+q²)) — sans ce raccourci, la récursion ne
// terminerait jamais (l'égalité peut se reproduire indéfiniment en théorie).
export function raceToNWinProb(p, target, winBy = 2) {
  const clamped = Math.min(1, Math.max(0, p));
  const q = 1 - clamped;
  if (clamped <= 0) return 0;
  if (clamped >= 1) return 1;
  const cache = new Map();
  function rec(a, b) {
    if (a >= target && a - b >= winBy) return 1;
    if (b >= target && b - a >= winBy) return 0;
    if (winBy === 2 && a === b && a >= target - 1) {
      return (clamped * clamped) / (clamped * clamped + q * q);
    }
    const key = `${a},${b}`;
    if (cache.has(key)) return cache.get(key);
    const result = clamped * rec(a + 1, b) + q * rec(a, b + 1);
    cache.set(key, result);
    return result;
  }
  return rec(0, 0);
}

// Un jeu de tennis est exactement une "course à 4 points, écart de 2" (avec égalités à
// 3-3, 4-4... au-delà de l'avantage) — cas particulier de raceToNWinProb, jamais un
// calcul dupliqué.
export function gameWinProb(p) {
  return raceToNWinProb(p, 4, 2);
}

// Jeu décisif (tie-break) : course à 7 points, écart de 2. Le service alterne tous les
// ~2 points (quasi à parts égales sur l'ensemble du jeu décisif) — on utilise ici la
// probabilité de point MOYENNE des deux joueurs plutôt que de suivre l'alternance
// exacte point par point : une simplification documentée dont l'écart avec un calcul
// exact est marginal en pratique (déjà utilisée dans les modèles d'analyse tennis).
export function tiebreakWinProb(p1PointOnServe, p2PointOnServe) {
  const avgP1PointWin = (p1PointOnServe + (1 - p2PointOnServe)) / 2;
  return raceToNWinProb(avgP1PointWin, 7, 2);
}

// Simule UN set à partir d'un état donné (par défaut 0-0, joueur 1 au service) et
// calcule, PAR VRAIE RÉCURRENCE (chaîne de Markov sur le score en jeux, mémoïsée —
// espace d'états fini et petit, jamais un tirage aléatoire), plusieurs grandeurs à la
// fois pour rester cohérentes entre elles :
//   - p1WinProb : probabilité que le joueur 1 gagne ce set
//   - expectedGames / expectedP1Games / expectedP2Games : nombre de jeux RESTANTS
//     attendus à partir de cet état (jamais un total fixe recopié d'un match à
//     l'autre — dépend entièrement de la probabilité de tenir son service de CHAQUE
//     joueur pour CE match précis)
//   - tiebreakProb : probabilité que ce set atteigne un jeu décisif (6-6)
//   - breaksP1 / breaksP2 : nombre de breaks RESTANTS attendus (jeux gagnés alors que
//     l'adversaire servait)
// `p1Hold`/`p2Hold` = probabilité que CHAQUE joueur tienne SON propre jeu de service
// (déjà calculée à partir des vraies statistiques de service/retour, voir
// lib/sports/tennis/statProfiles.js) — jamais une valeur partagée entre les deux
// joueurs. Appelée à partir de (0,0) pour le calcul FIGÉ avant-match, ou à partir du
// score en jeux ACTUEL pour le recalcul en direct (voir computeTennisLiveOverlay dans
// lib/sports/tennis/pronostic.js) : la même fonction sert aux deux cas, jamais deux
// implémentations qui pourraient diverger.
export function simulateSet(
  p1Hold,
  p2Hold,
  { startG1 = 0, startG2 = 0, firstServerIsP1 = true, p1PointOnServe = null, p2PointOnServe = null } = {}
) {
  const p1Point = p1PointOnServe ?? p1Hold;
  const p2Point = p2PointOnServe ?? p2Hold;
  const cache = new Map();

  function terminal(p1Wins) {
    return {
      p1WinProb: p1Wins ? 1 : 0,
      expectedGames: 0, expectedP1Games: 0, expectedP2Games: 0,
      tiebreakProb: 0, breaksP1: 0, breaksP2: 0,
    };
  }

  function state(g1, g2, serverIsP1) {
    if (g1 >= 6 && g1 - g2 >= 2) return terminal(true);
    if (g2 >= 6 && g2 - g1 >= 2) return terminal(false);
    if (g1 === 6 && g2 === 6) {
      const pWinTb = tiebreakWinProb(p1Point, p2Point);
      return {
        p1WinProb: pWinTb, expectedGames: 1, expectedP1Games: pWinTb, expectedP2Games: 1 - pWinTb,
        tiebreakProb: 1, breaksP1: 0, breaksP2: 0,
      };
    }

    const key = `${g1},${g2},${serverIsP1 ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);

    const holdP = serverIsP1 ? p1Hold : p2Hold;
    const p1WinsThisGame = serverIsP1 ? holdP : 1 - holdP;
    const isBreakIfP1Wins = !serverIsP1; // p1 gagne alors que p2 servait
    const isBreakIfP2Wins = serverIsP1; // p2 gagne alors que p1 servait

    const next1 = state(g1 + 1, g2, !serverIsP1);
    const next2 = state(g1, g2 + 1, !serverIsP1);

    const result = {
      p1WinProb: p1WinsThisGame * next1.p1WinProb + (1 - p1WinsThisGame) * next2.p1WinProb,
      expectedGames: 1 + p1WinsThisGame * next1.expectedGames + (1 - p1WinsThisGame) * next2.expectedGames,
      expectedP1Games:
        p1WinsThisGame * (1 + next1.expectedP1Games) + (1 - p1WinsThisGame) * next2.expectedP1Games,
      expectedP2Games:
        p1WinsThisGame * next1.expectedP2Games + (1 - p1WinsThisGame) * (1 + next2.expectedP2Games),
      tiebreakProb: p1WinsThisGame * next1.tiebreakProb + (1 - p1WinsThisGame) * next2.tiebreakProb,
      breaksP1:
        p1WinsThisGame * ((isBreakIfP1Wins ? 1 : 0) + next1.breaksP1) + (1 - p1WinsThisGame) * next2.breaksP1,
      breaksP2:
        p1WinsThisGame * next1.breaksP2 + (1 - p1WinsThisGame) * ((isBreakIfP2Wins ? 1 : 0) + next2.breaksP2),
    };
    cache.set(key, result);
    return result;
  }

  return state(startG1, startG2, firstServerIsP1);
}

// Moyenne des deux simulations (joueur 1 au service en premier / joueur 2 au service
// en premier) : sur l'ensemble d'un match, le premier serveur d'un set alterne
// globalement (tirage au sort du 1er set, puis alternance liée au dernier serveur du
// set précédent) — moyenner élimine l'avantage artificiel qu'aurait, sinon, un joueur
// fixé arbitrairement comme "toujours premier serveur" dans le calcul.
export function simulateSetSymmetric(p1Hold, p2Hold, opts = {}) {
  const a = simulateSet(p1Hold, p2Hold, { ...opts, firstServerIsP1: true });
  const b = simulateSet(p1Hold, p2Hold, { ...opts, firstServerIsP1: false });
  const avg = (x, y) => (x + y) / 2;
  return {
    p1WinProb: avg(a.p1WinProb, b.p1WinProb),
    expectedGames: avg(a.expectedGames, b.expectedGames),
    expectedP1Games: avg(a.expectedP1Games, b.expectedP1Games),
    expectedP2Games: avg(a.expectedP2Games, b.expectedP2Games),
    tiebreakProb: avg(a.tiebreakProb, b.tiebreakProb),
    breaksP1: avg(a.breaksP1, b.breaksP1),
    breaksP2: avg(a.breaksP2, b.breaksP2),
  };
}

// Distribution EXACTE des scores en sets (2-0/2-1/1-2/0-2 en 2 sets gagnants, jusqu'à
// 3-0/3-1/3-2/2-3/1-3/0-3 en 3 sets gagnants) à partir de la probabilité `pSet` que le
// joueur 1 gagne UN set (supposés indépendants et de même probabilité d'un set à
// l'autre — approximation standard documentée, l'alternance du service entre sets est
// déjà lissée par simulateSetSymmetric ci-dessus). Formule combinatoire exacte d'une
// "course au meilleur des N" (negative binomial) : le vainqueur doit gagner le DERNIER
// set de la série, et peut perdre n'importe quelle combinaison des sets précédents.
export function setScoreDistribution(pSet, bestOf) {
  const setsToWin = bestOf === 5 ? 3 : 2;
  const dist = [];
  for (let loserSets = 0; loserSets < setsToWin; loserSets++) {
    const waysCount = comb(setsToWin + loserSets - 1, loserSets);
    dist.push({
      winner: "p1",
      score: `${setsToWin}-${loserSets}`,
      probability: waysCount * Math.pow(pSet, setsToWin) * Math.pow(1 - pSet, loserSets),
    });
    dist.push({
      winner: "p2",
      score: `${loserSets}-${setsToWin}`,
      probability: waysCount * Math.pow(1 - pSet, setsToWin) * Math.pow(pSet, loserSets),
    });
  }
  return dist;
}

export function matchWinProbFromSetProb(pSet, bestOf) {
  return setScoreDistribution(pSet, bestOf)
    .filter((d) => d.winner === "p1")
    .reduce((sum, d) => sum + d.probability, 0);
}

// Nombre de sets attendu sur l'ensemble du match (ex : ~2,4 sets en moyenne pour un
// match au meilleur des 3 assez équilibré) — somme du nombre de sets de chaque
// scénario possible, pondérée par sa vraie probabilité.
export function expectedSetsPlayed(pSet, bestOf) {
  return setScoreDistribution(pSet, bestOf).reduce((sum, d) => {
    const [a, b] = d.score.split("-").map(Number);
    return sum + (a + b) * d.probability;
  }, 0);
}

// --- Recalcul EN DIRECT (voir lib/sports/tennis/pronostic.js#computeTennisLiveOverlay)
// — mêmes principes que ci-dessus, mais en partant du score en SETS déjà acquis
// (`setsWonP1`/`setsWonP2`) au lieu de 0-0 : la probabilité de gagner le match, la
// distribution des scores en sets et le nombre de sets restants attendus reflètent
// alors l'état RÉEL du match en cours, jamais recalculés comme si le match repartait
// de zéro.

// Probabilité que le joueur 1 gagne le match sachant qu'il mène déjà `setsWonP1` sets
// à `setsWonP2` (chaîne de Markov au niveau des sets, mémoïsée) — généralise
// matchWinProbFromSetProb (qui correspond exactement au cas particulier 0-0).
export function matchWinProbFromState(pSet, bestOf, setsWonP1, setsWonP2) {
  const setsToWin = bestOf === 5 ? 3 : 2;
  const cache = new Map();
  function rec(s1, s2) {
    if (s1 >= setsToWin) return 1;
    if (s2 >= setsToWin) return 0;
    const key = `${s1},${s2}`;
    if (cache.has(key)) return cache.get(key);
    const result = pSet * rec(s1 + 1, s2) + (1 - pSet) * rec(s1, s2 + 1);
    cache.set(key, result);
    return result;
  }
  return rec(setsWonP1, setsWonP2);
}

// Distribution EXACTE des scores finaux en sets sachant l'état actuel (`setsWonP1`-
// `setsWonP2`) — chaque score final déjà acquis + sets restants, jamais un nouveau
// tirage indépendant du score déjà réellement joué.
export function setScoreDistributionFromState(pSet, bestOf, setsWonP1, setsWonP2) {
  const setsToWin = bestOf === 5 ? 3 : 2;
  const results = [];
  function rec(s1, s2, prob) {
    if (prob < 1e-6) return;
    if (s1 >= setsToWin) {
      results.push({ winner: "p1", score: `${s1}-${s2}`, probability: prob });
      return;
    }
    if (s2 >= setsToWin) {
      results.push({ winner: "p2", score: `${s1}-${s2}`, probability: prob });
      return;
    }
    rec(s1 + 1, s2, prob * pSet);
    rec(s1, s2 + 1, prob * (1 - pSet));
  }
  rec(setsWonP1, setsWonP2, 1);
  return results;
}

// Nombre de sets ENCORE À JOUER (en comptant le set courant comme "à jouer en
// entier") à partir de l'état `setsWonP1`-`setsWonP2` — sert à estimer les jeux
// restants sur les sets qui n'ont pas encore commencé (voir computeTennisLiveOverlay,
// qui traite séparément le set EN COURS via simulateSetSymmetric avec un score de
// départ non nul).
export function expectedAdditionalSetsFromState(pSet, bestOf, setsWonP1, setsWonP2) {
  const setsToWin = bestOf === 5 ? 3 : 2;
  const cache = new Map();
  function rec(s1, s2) {
    if (s1 >= setsToWin || s2 >= setsToWin) return 0;
    const key = `${s1},${s2}`;
    if (cache.has(key)) return cache.get(key);
    const result = 1 + pSet * rec(s1 + 1, s2) + (1 - pSet) * rec(s1, s2 + 1);
    cache.set(key, result);
    return result;
  }
  return rec(setsWonP1, setsWonP2);
}
