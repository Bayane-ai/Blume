// "Combiné Vision" — l'app génère AUTOMATIQUEMENT des combinés (tickets), l'utilisateur
// ne sélectionne rien. Chaque combiné assemble des pronostics "assez sûrs" pris sur
// PLUSIEURS matchs différents (jamais deux lignes du même match dans un même combiné),
// dans le but d'atteindre une confiance combinée plus élevée qu'un pronostic seul —
// jamais de cote chiffrée affichée (voir PROMPT), seulement les sélections détaillées
// et un niveau de confiance.
//
// BLOC 2 — chaque sélection vient du pool `selectionCandidates` déjà calculé par
// lib/pronostic.js (computePronostic → buildSelectionCandidates) : 1X2, totaux de
// buts, tirs, tirs cadrés, cartons, corners, hors-jeu, fautes, touches — chacun avec
// une confiance RÉELLE (même modèle de Poisson que le reste du pronostic, dérivé des
// vraies statistiques de chaque équipe : classement/forme récente pour les buts
// attendus, intensité offensive + équilibre des forces pour le reste), une courte
// justification (voir BLOC 4.A) et une métadonnée de vérification (voir BLOC 4.B,
// lib/comboHistory.js). Ce fichier ne recalcule donc plus aucune statistique lui-même
// — il choisit juste, pour CE match, la sélection la plus fiable parmi ce pool, puis
// assemble les combinés. Tacles et homme du match restent absents : aucune source
// déjà connectée à ce site (football-data.org, API-Football) ne les fournit.
const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

// En dessous de ce seuil, l'issue 1X2 la plus probable n'est pas jugée "assez sûre"
// pour entrer dans un combiné (33,3 % est le neutre à 3 issues).
const WINNER_MIN_CONFIDENCE = 45;
// Tous les autres marchés du pool (totaux de buts, tirs, cartons, corners, hors-jeu,
// fautes, touches) sont des marchés Plus/Moins à 2 issues (neutre à 50 %) : même seuil,
// plus élevé que celui du 1X2, pour rester cohérent avec l'exigence "assez sûr".
const MARKET_MIN_CONFIDENCE = 58;

// Cartons jaunes/rouges sont des événements rares : leur ligne Plus/Moins "sûre" (voir
// riskLines dans lib/pronostic.js) atteint donc structurellement une confiance bien
// plus élevée que les autres marchés (totaux de buts, corners, fautes, touches, tirs),
// qui plafonnent naturellement plus près de leur seuil d'éligibilité. Sans traitement
// particulier, un simple "on prend la confiance la plus haute" favoriserait les
// cartons dans la quasi-totalité des combinés — ce que ce fichier doit justement
// éviter (voir PROMPT : cartons rares, jamais plus d'une sélection par combiné).
const CARTONS_LABELS = new Set(["Cartons jaunes", "Cartons rouges"]);

// BLOC 4.A — nombre de sélections par ticket, par niveau de risque (valeurs par
// défaut du PROMPT, ajustables ici) : peu risqué 2-3, moyennement risqué 3-4, très
// risqué 5-7. Les plages se chevauchent volontairement à 3 (comme demandé) — c'est la
// génération elle-même (generateCombos, ci-dessous) qui décide du niveau visé, pas une
// simple relecture du nombre final de lignes (voir riskLevelForLegCount plus bas, qui
// reste une approximation "au plus petit niveau" pour un usage externe).
export const LEG_COUNT_RANGES = { faible: [2, 3], moyen: [3, 4], eleve: [5, 7] };

// Nombre de lignes (matchs) d'un combiné → son niveau de risque affiché — sert de
// repli/documentation (ex. tests, affichage externe) : la génération elle-même (voir
// generateCombos) fixe le niveau de risque explicitement au moment de choisir le
// nombre de lignes, plutôt que de le redéduire après coup (les plages BLOC 4.A se
// chevauchant à 3 lignes, une simple relecture du nombre ne suffirait pas à lever
// l'ambiguïté). Ici, au plus petit niveau dont la plage contient ce nombre.
export function riskLevelForLegCount(legCount) {
  if (legCount <= LEG_COUNT_RANGES.faible[1]) return "faible";
  if (legCount <= LEG_COUNT_RANGES.moyen[1]) return "moyen";
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

// Une sélection du pool est "assez sûre" quand sa confiance RÉELLE dépasse le seuil de
// son type de marché (1X2 à 3 issues, ou marché Plus/Moins à 2 issues) — voir
// WINNER_MIN_CONFIDENCE/MARKET_MIN_CONFIDENCE ci-dessus.
function isEligible(candidate) {
  const threshold = candidate.marketLabel === "Issue du match" ? WINNER_MIN_CONFIDENCE : MARKET_MIN_CONFIDENCE;
  return candidate.confidence >= threshold;
}

// BLOC 4.C — horizon : les combinés ne portent que sur les matchs du jour et des
// prochaines 24-48h (/api/matches ramène une fenêtre plus large, 7 jours, pour
// "Matchs à venir" — ce filtre resserre spécifiquement le pool de Combiné Vision). Un
// match déjà en direct est par définition dans l'horizon, il se joue maintenant.
const HORIZON_MS = 48 * 3600 * 1000;
function isWithinHorizon(match) {
  if (LIVE_STATUSES.includes(match.status)) return true;
  const kickoff = new Date(match.utcDate).getTime();
  return Number.isFinite(kickoff) && kickoff - Date.now() <= HORIZON_MS;
}

// BLOC 4.C — "ne construire des combinés que sur les ligues où les stats sont
// fiables (ignorer celles avec trop peu de données)" : réutilise un signal RÉEL déjà
// calculé par lib/pronostic.js plutôt que d'inventer une nouvelle notion de fiabilité
// — quand le classement/la forme récente d'une équipe est introuvable, le pronostic
// retombe sur une estimation moyenne neutre (source "estimation moyenne", voir
// resolveFullMatchLambdas) : un signal honnête que la donnée manque pour ce match.
function hasReliableStats(pronostic) {
  return pronostic.home?.source !== "estimation moyenne" && pronostic.away?.source !== "estimation moyenne";
}

// BLOC 4.D — cas limite "sélection live qui tourne mal" : une sélection "Issue du
// match" en direct est jugée compromise quand l'équipe pariée est MENÉE au tableau
// d'affichage tard dans le match (peu de temps restant pour revenir) — un signal RÉEL
// (score/minute), jamais une probabilité recalculée arbitrairement. Les autres
// marchés (totaux de buts, corners...) utilisent une ligne qui se redéfinit elle-même
// à chaque actualisation (voir lib/pronostic.js, computeLiveOutcome) : ils n'ont donc
// pas cette même notion d'échec "en cours de route" entre deux actualisations.
const COMPROMISED_MINUTE = 75;
function isLegCompromised(leg) {
  if (!leg.isLive || leg.verify?.type !== "winner") return false;
  const score = leg.match?.score?.fullTime;
  const minute = leg.match?.minute;
  if (!score || minute == null || minute < COMPROMISED_MINUTE) return false;
  const home = Number(score.home);
  const away = Number(score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return false;
  if (leg.verify.key === "home") return away > home;
  if (leg.verify.key === "away") return home > away;
  if (leg.verify.key === "draw") return home !== away;
  return false;
}

// Meilleure ligne "assez sûre" pour CE match précis, choisie parmi TOUT le pool de
// sélections déjà calculé par lib/pronostic.js (computePronostic → selectionCandidates :
// 1X2, totaux de buts, tirs, cartons, corners, hors-jeu, fautes, touches). `null` si
// aucune sélection n'atteint son seuil de confiance minimum, si le match est hors de
// l'horizon 24-48h, ou si les stats d'une des deux équipes ne sont pas assez fiables
// (voir BLOC 4.C) — jamais une ligne inventée pour remplir un ticket.
export function pickLegForMatch(match) {
  const p = match?.pronostic;
  if (!p || p.available === false || !Array.isArray(p.selectionCandidates)) return null;
  if (!isWithinHorizon(match)) return null;
  if (!hasReliableStats(p)) return null;

  const homeName = p.home?.name || match.homeTeam?.name || "Domicile";
  const awayName = p.away?.name || match.awayTeam?.name || "Extérieur";

  const eligible = p.selectionCandidates.filter(isEligible);
  if (eligible.length === 0) return null;

  // Priorité aux marchés autres que cartons (totaux de buts, corners, fautes, touches,
  // tirs, tirs cadrés, hors-jeu, 1X2 — voir PROMPT "privilégie en priorité...") : les
  // cartons ne sont retenus pour CE match que si aucun autre marché n'est éligible ici
  // (dernier recours par match, jamais un choix par défaut).
  const nonCartons = eligible.filter((c) => !CARTONS_LABELS.has(c.marketLabel));
  const candidatePool = nonCartons.length > 0 ? nonCartons : eligible;

  // Parmi les sélections retenues pour ce match, celle dont la confiance RÉELLE est la
  // plus haute — jamais un choix arbitraire.
  const best = candidatePool.reduce((a, b) => (b.confidence > a.confidence ? b : a));

  const leg = {
    matchId: match.id,
    homeTeamName: homeName,
    awayTeamName: awayName,
    competitionName: match.competition?.name || "Compétition",
    isLive: LIVE_STATUSES.includes(match.status),
    match,
    comp: match.competition,
    marketLabel: best.marketLabel,
    pickLabel: best.pickLabel,
    reason: best.reason || null,
    verify: best.verify || null,
    confidence: round1(best.confidence),
  };
  leg.compromised = isLegCompromised(leg);
  return leg;
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
// lignes s'ajoutent. BLOC 4.A — "pas de sélections liées" : chaque ligne vient d'un
// match différent (voir buildLegPool ci-dessus, jamais deux lignes du même match dans
// le même combiné), donc l'hypothèse d'indépendance entre lignes reste raisonnable ;
// deux lignes du MÊME match, elles, seraient statistiquement dépendantes (une fausse
// sécurité) — c'est justement ce que buildLegPool empêche structurellement.
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

// Tire `count` lignes distinctes dans `pool`, en limitant les cartons à AU PLUS une
// seule sélection (voir PROMPT : "au maximum 1 sélection carton par combiné"), et
// seulement quand `allowCartons` l'autorise pour ce tirage (voir CARTONS_COMBO_CHANCE
// ci-dessous — la plupart des combinés n'en contiennent aucune). `null` si le pool ne
// permet pas d'assembler `count` lignes dans ces conditions — jamais un combiné rempli
// avec plus de cartons que permis pour compenser un pool trop petit.
function sampleLegsWithCartonsBudget(pool, count, random, allowCartons) {
  const cartonsPool = pool.filter((l) => CARTONS_LABELS.has(l.marketLabel));
  const otherPool = pool.filter((l) => !CARTONS_LABELS.has(l.marketLabel));
  if (allowCartons && cartonsPool.length > 0 && otherPool.length >= count - 1) {
    const cartonsLeg = sampleWithoutReplacement(cartonsPool, 1, random);
    const others = sampleWithoutReplacement(otherPool, count - 1, random);
    return [...cartonsLeg, ...others];
  }
  if (otherPool.length >= count) {
    return sampleWithoutReplacement(otherPool, count, random);
  }
  return null;
}

// BLOC 4.A — tire un nombre de lignes au hasard dans la plage du niveau de risque visé
// (voir LEG_COUNT_RANGES), borné par ce que le pool permet réellement — `null` si le
// pool est trop petit pour honorer ce niveau (le niveau n'est alors simplement pas
// tenté, jamais rempli avec moins de lignes que sa plage ne l'exige).
function randomLegCount(riskLevel, poolLength, random) {
  const [min, max] = LEG_COUNT_RANGES[riskLevel];
  const upper = Math.min(max, poolLength);
  if (upper < min) return null;
  return min + Math.floor(random() * (upper - min + 1));
}

// BLOC 5 — "Combiné mixte" : un combiné peut contenir à la fois des matchs en direct
// et des matchs à venir. `isLive` (comme `compromised`) se déduit donc toujours des
// VRAIES lignes qui composent CE combiné — jamais d'un simple indicateur transmis par
// l'appelant, qui pourrait se tromper dès qu'un tirage "peu risqué" ordinaire pioche
// par hasard une ligne en direct dans le pool mixte (voir generateCombos ci-dessous).
function buildCombo(legs, { riskLevel } = {}) {
  const confidence = combinedConfidence(legs);
  const sortedIds = [...legs.map((l) => l.matchId)].sort((a, b) => a - b);
  const isLive = legs.some((l) => l.isLive);
  const compromised = isLive && legs.some((l) => l.compromised);
  return {
    id: `combo-${riskLevel}-${sortedIds.join("-")}-${isLive ? "live" : "prematch"}`,
    riskLevel,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    isLive,
    // BLOC 4.D — "la marquer comme compromise (et ne plus la proposer comme
    // opportunité fraîche)" : le combiné reste affiché (transparence), mais
    // components/CombinedVisionTicket.js n'affiche plus la mention "saisir
    // l'occasion" pour un combiné compromis (voir ci-dessous).
    compromised,
    legs,
  };
}

// En dessous de ce nombre de lignes éligibles dans le pool, un niveau de risque donné
// n'est tout simplement pas tenté (pas assez de matchs pour l'assembler honnêtement).
const RISKY_LEG_COUNT = LEG_COUNT_RANGES.eleve[0];
// Probabilité, à CHAQUE génération, de tenter un combiné "très risqué" — délibérément
// faible : "proposés rarement, pas trop souvent" (voir PROMPT), sans avoir besoin de
// mémoriser un historique des générations précédentes.
const RISKY_COMBO_CHANCE = 0.25;
// Probabilité, à CHAQUE combiné assemblé, d'autoriser UNE sélection carton parmi ses
// lignes (voir sampleLegsWithCartonsBudget) — délibérément faible : "quelques rares
// fois, pas dans la plupart" (voir PROMPT). Le reste du temps, le combiné est composé
// exclusivement de marchés non-cartons (totaux de buts, corners, fautes, touches, tirs,
// tirs cadrés, hors-jeu, 1X2).
const CARTONS_COMBO_CHANCE = 0.15;

// Génère les combinés à afficher, à partir des VRAIS matchs actuellement chargés
// (à venir + en direct, déjà munis chacun de leur pronostic réel — voir
// pages/api/matches.js / pages/api/live-matches.js, qui les calculent gratuitement,
// sans appel supplémentaire à l'API). Jamais de match inventé : si le pool de lignes
// "assez sûres" est trop petit, renvoie simplement moins de combinés (ou aucun),
// plutôt que d'en inventer un avec des lignes en dessous du seuil de confiance — voir
// BLOC 4.D, "aucun combiné fiable disponible : ne rien forcer".
export function generateCombos(matches, { random = Math.random } = {}) {
  const pool = buildLegPool(matches);
  if (pool.length < 2) return [];

  const combos = [];
  const usedComboKeys = new Set(); // évite deux combinés strictement identiques (mêmes matchs)

  function tryAddCombo(riskLevel, { fromPool = pool } = {}) {
    const legCount = randomLegCount(riskLevel, fromPool.length, random);
    if (!legCount) return false;
    // Rarement, une seule sélection carton max ; le plus souvent, aucune (voir
    // CARTONS_COMBO_CHANCE / sampleLegsWithCartonsBudget) — jamais un combiné à 100%
    // cartons, jamais plus d'une sélection carton.
    const allowCartons = random() < CARTONS_COMBO_CHANCE;
    const sampled = sampleLegsWithCartonsBudget(fromPool, legCount, random, allowCartons);
    if (!sampled) return false;
    const legs = sampled.sort((a, b) => b.confidence - a.confidence);
    const key = legs.map((l) => l.matchId).sort((a, b) => a - b).join("-");
    if (usedComboKeys.has(key)) return false;
    usedComboKeys.add(key);
    combos.push(buildCombo(legs, { riskLevel }));
    return true;
  }

  // Combinés peu risqués et moyennement risqués : proposés régulièrement, à chaque
  // actualisation (tant que le pool le permet).
  tryAddCombo("faible");
  tryAddCombo("faible");
  tryAddCombo("moyen");

  // Combiné très risqué : rare, jamais garanti à chaque actualisation.
  if (pool.length >= RISKY_LEG_COUNT && random() < RISKY_COMBO_CHANCE) {
    tryAddCombo("eleve");
  }

  // Combiné "En live" : uniquement si de vraies lignes en direct existent dans le pool
  // à cet instant — jamais artificiellement forcé (voir PROMPT : "parfois pendant les
  // matchs"). Mélange une ligne en direct avec, si possible, des lignes pré-match pour
  // rester un vrai combiné à plusieurs matchs. Peu/moyennement risqué la plupart du
  // temps ; très risqué seulement de temps en temps, avec la même rareté que le
  // combiné pré-match très risqué ci-dessus (voir BLOC 3 : "les opportunités live
  // très risquées restent rares", pas impossibles).
  const livePool = pool.filter((l) => l.isLive);
  if (livePool.length > 0) {
    const wantsRisky = pool.length >= RISKY_LEG_COUNT && random() < RISKY_COMBO_CHANCE;
    const preferredTier = wantsRisky ? "eleve" : (random() < 0.5 ? "moyen" : "faible");
    const legCount = randomLegCount(preferredTier, pool.length, random) || randomLegCount("faible", pool.length, random);
    if (legCount) {
      // La ligne live garantie privilégie elle aussi les marchés non-cartons (ne
      // retombe sur un carton que si c'est la SEULE ligne live disponible) — voir
      // pickLegForMatch, même logique de priorité appliquée ici au tirage de la ligne
      // live obligatoire.
      const liveNonCartons = livePool.filter((l) => !CARTONS_LABELS.has(l.marketLabel));
      const liveCandidates = liveNonCartons.length > 0 ? liveNonCartons : livePool;
      const guaranteedLive = sampleWithoutReplacement(liveCandidates, 1, random);
      const liveIsCartons = CARTONS_LABELS.has(guaranteedLive[0].marketLabel);
      const rest = pool.filter((l) => l.matchId !== guaranteedLive[0].matchId);
      // Si la ligne live garantie est déjà un carton, le budget "1 carton max par
      // combiné" est consommé : le reste du tirage n'en autorise plus aucun.
      const allowCartons = !liveIsCartons && random() < CARTONS_COMBO_CHANCE;
      const restLegs = sampleLegsWithCartonsBudget(rest, legCount - 1, random, allowCartons);
      if (restLegs) {
        const legs = [...guaranteedLive, ...restLegs].sort((a, b) => b.confidence - a.confidence);
        // Même format de clé que tryAddCombo ci-dessus (sans préfixe "live-") : deux
        // combinés portant exactement les mêmes matchs sont le même combiné, qu'il ait
        // été produit par ce tirage dédié ou par un tirage "ordinaire" qui a pioché par
        // hasard les mêmes lignes — jamais deux entrées distinctes (même id, voir
        // buildCombo) pour la même proposition.
        const key = legs.map((l) => l.matchId).sort((a, b) => a - b).join("-");
        if (!usedComboKeys.has(key)) {
          usedComboKeys.add(key);
          combos.push(buildCombo(legs, { riskLevel: riskLevelForLegCount(legCount) }));
        }
      }
    }
  }

  return combos;
}
