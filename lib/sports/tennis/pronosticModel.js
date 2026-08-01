// Bloc 7 — moteur de pronostics tennis, même rôle que lib/pronostic.js (football) et
// lib/sports/basketball/pronosticModel.js (basket), mais bâti sur le modèle de Markov
// jeu -> set -> match de lib/sports/tennis/matchModel.js (voir ce fichier pour le
// pourquoi : ni la loi de Poisson du football ni l'approximation normale du basket ne
// conviennent au tennis). Croise les DEUX profils réels de joueur (lib/sports/tennis/
// statProfiles.js — classement, forme, surface, service/retour, fatigue) pour
// produire les 11 blocs demandés, jamais les mêmes valeurs recopiées d'un match à
// l'autre : tout part de `homeProfile`/`awayProfile`, propres à CE match précis.
//
// Comme pour le basket (voir lib/sports/basketball/pronostic.js, resté un stub
// honnête), lib/sports/tennis/pronostic.js — l'interface générique du registre des
// sports, voir lib/sports/registry.js — n'est PAS modifié par ce fichier : c'est ici,
// dans pronosticModel.js, que vit le vrai calcul, importé directement par pages/api/
// tennis/analyze.js, exactement comme pronosticModel.js du basket est importé
// directement par pages/api/basketball/analyze.js sans passer par le registre.
import {
  gameWinProb, simulateSetSymmetric, setScoreDistribution, matchWinProbFromSetProb,
  expectedSetsPlayed, matchWinProbFromState, setScoreDistributionFromState, expectedAdditionalSetsFromState,
} from "./matchModel";
import { overUnderLine, riskLines, round1 } from "../../pronostic";

function safeVal(field) {
  return field?.available ? field.value : null;
}

// Probabilité qu'un joueur gagne un point sur SON service face à un adversaire précis
// : moyenne de sa propre force de service et de la FAIBLESSE de retour de
// l'adversaire (même principe que lib/pronosticFromProfiles.js#crossExpectation,
// attaque d'un côté x défense de l'autre — ici service x retour) — jamais la force de
// service d'un joueur utilisée seule, indépendamment de qui il affronte. Bornée à une
// plage réaliste (aucun joueur professionnel ne gagne durablement moins de 35 % ni
// plus de 92 % de ses points de service, quel que soit l'adversaire).
function effectivePointWinOnServe(server, returner) {
  const serve = safeVal(server?.serveWinPct) ?? 62;
  const ret = safeVal(returner?.returnWinPct) ?? 38;
  const combined = (serve + (100 - ret)) / 2;
  return Math.min(92, Math.max(35, combined)) / 100;
}

function lineOrUnavailable(total, opts) {
  if (total == null || !Number.isFinite(total)) return { available: false };
  return { available: true, ...overUnderLine(total, opts) };
}

// Confrontations directes réelles entre CES deux joueurs (voir lib/sports/tennis/
// provider.js#getHeadToHead) : détermine le vainqueur de chaque match à partir des
// vrais scores de sets (même convention `scores.home/away.set_N` que le reste du
// module tennis), jamais un résultat supposé.
function matchWinnerIsHome(game) {
  let homeSets = 0;
  let awaySets = 0;
  for (const key of ["set_1", "set_2", "set_3", "set_4", "set_5"]) {
    const h = game?.scores?.home?.[key];
    const a = game?.scores?.away?.[key];
    if (typeof h !== "number" || typeof a !== "number") continue;
    if (h > a) homeSets += 1;
    else if (a > h) awaySets += 1;
  }
  if (homeSets === awaySets) return null;
  return homeSets > awaySets;
}

function summarizeH2H(h2hGames, homeId) {
  const finished = (h2hGames || []).filter((g) =>
    /finished|retired|walkover|^ft$/i.test(`${g?.status?.long || ""} ${g?.status?.short || ""}`.trim())
  );
  let homeWins = 0;
  let awayWins = 0;
  for (const g of finished) {
    const gameHomeId = g?.teams?.home?.id ?? g?.players?.home?.id;
    const homeWonThisGame = matchWinnerIsHome(g);
    if (homeWonThisGame == null) continue;
    // `homeWonThisGame` est relatif au "domicile" DE CE match d'historique précis
    // (pas forcément le même joueur que le "domicile" du match analysé) — on ramène
    // donc au bon joueur avant de compter.
    const winnerIsOurHome = String(gameHomeId) === String(homeId) ? homeWonThisGame : !homeWonThisGame;
    if (winnerIsOurHome) homeWins += 1;
    else awayWins += 1;
  }
  return { matchesPlayed: homeWins + awayWins, homeWins, awayWins };
}

// Pondération minoritaire de l'historique direct (même philosophie que
// lib/pronostic.js#applyHeadToHead) : au plus 18 %, et seulement si au moins 2
// confrontations réelles existent — jamais un historique ancien ou trop maigre qui
// dominerait le modèle statistique construit sur les vrais profils actuels des deux
// joueurs.
const H2H_MAX_WEIGHT = 0.18;
function applyH2H(matchWinProb, h2hSummary) {
  if (!h2hSummary || h2hSummary.matchesPlayed < 2) return { probability: matchWinProb, used: false };
  const h2hWinRate = h2hSummary.homeWins / h2hSummary.matchesPlayed;
  const weight = Math.min(H2H_MAX_WEIGHT, 0.04 * h2hSummary.matchesPlayed);
  return { probability: matchWinProb * (1 - weight) + h2hWinRate * weight, used: true };
}

// `round1` (lib/pronostic.js) convertit une FRACTION 0..1 en pourcentage — les champs
// de profil (voir lib/sports/tennis/statProfiles.js) sont déjà des pourcentages
// (échelle 0..100), jamais des fractions : un arrondi simple suffit ici, contrairement
// à round1 qui les multiplierait par 100 une seconde fois.
function roundPctValue(x) {
  return x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
}

function formatPct(value) {
  return value == null ? null : roundPctValue(value);
}

// Bloc 1 — courte justification (1-2 phrases), à partir des vrais chiffres de CE
// match : classement, forme, surface, confrontations directes — jamais un texte
// générique recopié d'un match à l'autre.
function buildWinProbabilityReason({ homeName, awayName, favoriteIsHome, favoritePct, homeProfile, awayProfile, surface, h2hSummary, h2hUsed }) {
  const favoriteProfile = favoriteIsHome ? homeProfile : awayProfile;
  const favoriteName = favoriteIsHome ? homeName : awayName;
  const opponentName = favoriteIsHome ? awayName : homeName;
  const rankingBit = favoriteProfile.ranking != null ? `, classé(e) ${favoriteProfile.ranking}ᵉ mondial(e)` : "";
  const formBit = favoriteProfile.form ? ` (forme récente : ${favoriteProfile.form})` : "";
  const surfaceBit = surface ? ` sur ${surface.toLowerCase()}` : "";
  const h2hBit = h2hUsed && h2hSummary?.matchesPlayed
    ? ` Les confrontations directes (${h2hSummary.homeWins}-${h2hSummary.awayWins} en ${h2hSummary.matchesPlayed} rencontre${h2hSummary.matchesPlayed > 1 ? "s" : ""}) confirment cette tendance.`
    : "";
  return `${favoriteName} part favori(te) (${favoritePct} %)${rankingBit}${formBit}, avec un service jugé plus solide${surfaceBit} face au retour de ${opponentName}.${h2hBit}`;
}

// Bloc 11 — scénario du match (2-4 phrases) : qui domine au service, où se jouent les
// breaks, influence de la surface — dérivé des mêmes chiffres que le reste du calcul.
function buildMatchScenario({ homeName, awayName, homeHoldPct, awayHoldPct, surface, breaksTotal, tiebreakLikely, favoriteIsHome }) {
  const strongerServer = homeHoldPct >= awayHoldPct ? homeName : awayName;
  const weakerServer = homeHoldPct >= awayHoldPct ? awayName : homeName;
  const surfaceBit = surface ? `Sur ${surface.toLowerCase()}, ` : "";
  const sentences = [
    `${surfaceBit}${strongerServer} devrait tenir son service plus facilement que ${weakerServer} sur l'ensemble du match.`,
  ];
  if (breaksTotal >= 3) {
    sentences.push(`Les deux joueurs devraient concéder des breaks à plusieurs reprises : les jeux de retour seront décisifs.`);
  } else {
    sentences.push(`Peu de breaks sont attendus : l'issue devrait se jouer sur quelques points serrés au service.`);
  }
  if (tiebreakLikely) sentences.push(`Au moins un jeu décisif est probable si les deux services restent aussi dominants.`);
  sentences.push(`${favoriteIsHome ? homeName : awayName} entre dans ce match avec l'avantage statistique global.`);
  return sentences.join(" ");
}

// Point d'entrée FIGÉ (avant-match) — calcule tout une seule fois, comme lib/
// pronosticFromProfiles.js#computeMatchLinesFromProfiles côté football. `bestOf` :
// 3 (par défaut) ou 5 (Grand Chelem masculin — décidé par l'appelant, voir pages/api/
// tennis/analyze.js, à partir de la vraie catégorie du tournoi, jamais deviné ici).
export function computeTennisPronostic({ homeProfile, awayProfile, homeTeamName, awayTeamName, h2hGames = null, homeId = null, bestOf = 3, surface = null }) {
  if (!homeProfile?.available || !awayProfile?.available) {
    return { available: false, reason: "profil de joueur indisponible" };
  }
  const hName = homeTeamName || "Joueur 1";
  const aName = awayTeamName || "Joueur 2";

  const p1PointOnServe = effectivePointWinOnServe(homeProfile, awayProfile);
  const p2PointOnServe = effectivePointWinOnServe(awayProfile, homeProfile);
  const p1Hold = gameWinProb(p1PointOnServe);
  const p2Hold = gameWinProb(p2PointOnServe);

  const setSim = simulateSetSymmetric(p1Hold, p2Hold, { p1PointOnServe, p2PointOnServe });
  const pSet = setSim.p1WinProb;

  const rawMatchWinProb = matchWinProbFromSetProb(pSet, bestOf);
  const h2hSummary = h2hGames ? summarizeH2H(h2hGames, homeId) : null;
  const { probability: matchWinProb, used: h2hUsed } = applyH2H(rawMatchWinProb, h2hSummary);

  const probabilities = { home: round1(matchWinProb), away: round1(1 - matchWinProb) };
  const favoriteIsHome = probabilities.home >= probabilities.away;

  // Bloc 2 — scores en sets probables : distribution EXACTE (voir matchModel.js),
  // triée par probabilité décroissante — le mélange de scénarios courts/accrochés
  // apparaît naturellement (un score "net" et sa variante "accrochée" ont
  // généralement des probabilités proches, voir lib/sports/tennis/matchModel.js).
  const setScores = setScoreDistribution(pSet, bestOf)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 4)
    .map((d) => ({
      score: d.winner === "p1" ? d.score : d.score.split("-").reverse().join("-"),
      winner: d.winner,
      probability: round1(d.probability),
    }));

  // Bloc 3 — totaux de jeux (match entier) : nombre de sets attendu x jeux attendus
  // par set (approximation documentée — voir matchModel.js#simulateSetSymmetric).
  const eSets = expectedSetsPlayed(pSet, bestOf);
  const totalGames = eSets * setSim.expectedGames;
  const totalGamesP1 = eSets * setSim.expectedP1Games;
  const totalGamesP2 = eSets * setSim.expectedP2Games;
  const gameTotals = {
    total: lineOrUnavailable(totalGames, { withMargin: true }),
    home: lineOrUnavailable(totalGamesP1, { withMargin: true }),
    away: lineOrUnavailable(totalGamesP2, { withMargin: true }),
  };

  // Bloc 4 — handicap jeux : écart de jeux attendu, toujours du point de vue du
  // favori (même mécanique que lib/sports/basketball/pronosticModel.js#buildPointSpread).
  const gameDiff = totalGamesP1 - totalGamesP2;
  const gameHandicapFavorite = gameDiff >= 0 ? "home" : "away";
  const gameHandicapLines = riskLines(Math.abs(gameDiff));
  const gameHandicap = { favorite: gameHandicapFavorite, safe: gameHandicapLines.safe, risky: gameHandicapLines.risky };

  // Bloc 5 — sets : total de sets, "les deux gagnent au moins un set", 1er set.
  const totalSetsLine = bestOf === 5 ? 3.5 : 2.5;
  const totalSets = { line: totalSetsLine, side: eSets > totalSetsLine ? "Plus" : "Moins" };
  const cleanSweepProb = setScoreDistribution(pSet, bestOf)
    .filter((d) => d.score.includes("-0") || d.score.startsWith("0-"))
    .reduce((s, d) => s + d.probability, 0);
  const bothWinASet = 1 - cleanSweepProb >= 0.5 ? "Oui" : "Non";
  const firstSetWinner = pSet >= 0.5 ? "home" : "away";
  const firstSetGames = lineOrUnavailable(setSim.expectedGames);
  const setsBlock = { totalSets, bothWinASet, firstSetWinner, firstSetGames };

  // Blocs 6-7 — aces / doubles fautes : moyenne réelle par match de chaque joueur
  // (lib/sports/tennis/statProfiles.js), jamais un croisement service/retour (pas de
  // notion d'"attaque x défense" naturelle pour ces deux statistiques, même principe
  // que les tirs/cartons du football, voir lib/pronosticFromProfiles.js).
  function ownStatBlock(homeField, awayField, { withMargin = false } = {}) {
    const homeVal = safeVal(homeField);
    const awayVal = safeVal(awayField);
    const total = homeVal != null && awayVal != null ? homeVal + awayVal : null;
    return { total: lineOrUnavailable(total, { withMargin }), home: lineOrUnavailable(homeVal), away: lineOrUnavailable(awayVal) };
  }
  const aces = ownStatBlock(homeProfile.acesPerMatch, awayProfile.acesPerMatch, { withMargin: true });
  const doubleFaults = ownStatBlock(homeProfile.doubleFaultsPerMatch, awayProfile.doubleFaultsPerMatch, { withMargin: true });

  // Bloc 8 — breaks : dérivés DIRECTEMENT du même modèle de Markov (setSim), pas
  // d'une moyenne séparée — un break, c'est précisément "perdre son jeu de service",
  // déjà calculé pour estimer les jeux/le set lui-même : une seule source de vérité.
  const breaksHome = eSets * setSim.breaksP1; // fois où joueur 1 casse le service de joueur 2
  const breaksAway = eSets * setSim.breaksP2;
  const breaks = {
    total: lineOrUnavailable(breaksHome + breaksAway, { withMargin: true }),
    home: lineOrUnavailable(breaksHome),
    away: lineOrUnavailable(breaksAway),
  };

  // Bloc 9 — jeu décisif (tie-break) : probabilité qu'AU MOINS un des sets réellement
  // joués atteigne 6-6 (approximation documentée : sets traités comme indépendants,
  // voir matchModel.js).
  const tiebreakProbability = 1 - Math.pow(1 - setSim.tiebreakProb, Math.max(1, Math.round(eSets)));
  const tiebreak = { likely: tiebreakProbability > 0.5 ? "Oui" : "Non" };

  // Bloc 10 — contexte service/retour : éléments d'analyse descriptifs, jamais un
  // marché Plus/Moins (voir PROMPT : "présentés comme éléments d'analyse").
  const serviceReturnContext = {
    home: {
      firstServeInPct: formatPct(safeVal(homeProfile.firstServeInPct)),
      firstServeWonPct: formatPct(safeVal(homeProfile.firstServeWonPct)),
      secondServeWonPct: formatPct(safeVal(homeProfile.secondServeWonPct)),
      breakPointsConvertedPct: formatPct(safeVal(homeProfile.breakPointsWonPct)),
    },
    away: {
      firstServeInPct: formatPct(safeVal(awayProfile.firstServeInPct)),
      firstServeWonPct: formatPct(safeVal(awayProfile.firstServeWonPct)),
      secondServeWonPct: formatPct(safeVal(awayProfile.secondServeWonPct)),
      breakPointsConvertedPct: formatPct(safeVal(awayProfile.breakPointsWonPct)),
    },
  };

  const narrative = {
    winProbability: buildWinProbabilityReason({
      homeName: hName, awayName: aName, favoriteIsHome,
      favoritePct: Math.max(probabilities.home, probabilities.away),
      homeProfile, awayProfile, surface, h2hSummary, h2hUsed,
    }),
    matchScenario: buildMatchScenario({
      homeName: hName, awayName: aName, homeHoldPct: p1Hold, awayHoldPct: p2Hold, surface,
      breaksTotal: breaksHome + breaksAway, tiebreakLikely: tiebreak.likely === "Oui", favoriteIsHome,
    }),
  };

  return {
    available: true,
    live: false,
    bestOf,
    surface,
    home: { name: hName, ranking: homeProfile.ranking, form: homeProfile.form, source: "profil de joueur (Bloc 7)" },
    away: { name: aName, ranking: awayProfile.ranking, form: awayProfile.form, source: "profil de joueur (Bloc 7)" },
    probabilities,
    setScores,
    gameTotals,
    gameHandicap,
    setsBlock,
    aces,
    doubleFaults,
    breaks,
    tiebreak,
    serviceReturnContext,
    narrative,
    h2hUsed,
    h2hSummary,
    // Conservés pour le recalcul en direct (voir computeTennisLiveOverlay ci-dessous)
    // sans revenir chercher les profils de joueur — même principe que lib/sports/
    // basketball/pronosticModel.js (sdHome/sdAway conservés dans le pronostic figé).
    modelState: { p1Hold, p2Hold, p1PointOnServe, p2PointOnServe, pSet },
    note: "Estimation statistique (modèle de Markov jeu → set → match) basée sur les vrais matchs récents de chaque joueur, sur la surface du tournoi et sur l'historique des confrontations directes — pas une IA.",
  };
}

// Recalcul EN DIRECT (voir PROMPT, "Règle figé/live") : UNIQUEMENT probabilité de
// victoire, scores en sets probables et totaux de jeux. Aces/doubles fautes/breaks/
// tie-break/handicap restent figés (jamais recalculés ici, voir pages/api/tennis/
// analyze.js qui ne réutilise ce résultat QUE pour ces trois blocs précis).
// `modelState` vient du pronostic déjà FIGÉ (voir ci-dessus) ; `liveState` = état réel
// actuel du match (sets gagnés + score en jeux du set en cours).
export function computeTennisLiveOverlay({ modelState, bestOf = 3, liveState = null }) {
  const { p1Hold, p2Hold, p1PointOnServe, p2PointOnServe, pSet } = modelState;
  if (!liveState) {
    // Avant le début du match : identique au calcul figé (voir computeTennisPronostic).
    const setSim = simulateSetSymmetric(p1Hold, p2Hold, { p1PointOnServe, p2PointOnServe });
    const eSets = expectedSetsPlayed(pSet, bestOf);
    return {
      probabilities: { home: round1(matchWinProbFromSetProb(pSet, bestOf)), away: round1(1 - matchWinProbFromSetProb(pSet, bestOf)) },
      setScores: setScoreDistribution(pSet, bestOf).sort((a, b) => b.probability - a.probability).slice(0, 4).map((d) => ({
        score: d.winner === "p1" ? d.score : d.score.split("-").reverse().join("-"), winner: d.winner, probability: round1(d.probability * 100),
      })),
      gameTotals: {
        total: lineOrUnavailable(eSets * setSim.expectedGames, { withMargin: true }),
        home: lineOrUnavailable(eSets * setSim.expectedP1Games, { withMargin: true }),
        away: lineOrUnavailable(eSets * setSim.expectedP2Games, { withMargin: true }),
      },
    };
  }

  const { setsWonHome = 0, setsWonAway = 0, currentSetGamesHome = 0, currentSetGamesAway = 0, gamesPlayedHome = 0, gamesPlayedAway = 0 } = liveState;

  const remaining = simulateSetSymmetric(p1Hold, p2Hold, {
    startG1: currentSetGamesHome, startG2: currentSetGamesAway, p1PointOnServe, p2PointOnServe,
  });
  const pWinCurrentSet = remaining.p1WinProb;

  const liveMatchWinProb =
    pWinCurrentSet * matchWinProbFromState(pSet, bestOf, setsWonHome + 1, setsWonAway) +
    (1 - pWinCurrentSet) * matchWinProbFromState(pSet, bestOf, setsWonHome, setsWonAway + 1);

  const setScores = setScoreDistributionFromState(pSet, bestOf, setsWonHome, setsWonAway)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 4)
    .map((d) => ({
      score: d.winner === "p1" ? d.score : d.score.split("-").reverse().join("-"), winner: d.winner, probability: round1(d.probability * 100),
    }));

  // Jeux restants = ceux du set en cours (calcul exact, DP à partir du score actuel)
  // + une estimation des sets qui n'ont pas encore commencé (nombre de sets restants
  // attendu x profil d'un set complet "frais" — approximation documentée, voir
  // lib/sports/tennis/matchModel.js). Jeux déjà joués (`gamesPlayedHome/Away`, fournis
  // par l'appelant à partir du score réel actuel) ajoutés pour un total ABSOLU sur
  // tout le match, jamais seulement "ce qu'il reste à jouer".
  const additionalFutureSets =
    pWinCurrentSet * expectedAdditionalSetsFromState(pSet, bestOf, setsWonHome + 1, setsWonAway) +
    (1 - pWinCurrentSet) * expectedAdditionalSetsFromState(pSet, bestOf, setsWonHome, setsWonAway + 1);
  const freshSet = simulateSetSymmetric(p1Hold, p2Hold, { p1PointOnServe, p2PointOnServe });

  const totalGames = gamesPlayedHome + gamesPlayedAway + remaining.expectedGames + additionalFutureSets * freshSet.expectedGames;
  const totalGamesHome = gamesPlayedHome + remaining.expectedP1Games + additionalFutureSets * freshSet.expectedP1Games;
  const totalGamesAway = gamesPlayedAway + remaining.expectedP2Games + additionalFutureSets * freshSet.expectedP2Games;

  return {
    probabilities: { home: round1(liveMatchWinProb), away: round1(1 - liveMatchWinProb) },
    setScores,
    gameTotals: {
      total: lineOrUnavailable(totalGames, { withMargin: true }),
      home: lineOrUnavailable(totalGamesHome, { withMargin: true }),
      away: lineOrUnavailable(totalGamesAway, { withMargin: true }),
    },
  };
}
