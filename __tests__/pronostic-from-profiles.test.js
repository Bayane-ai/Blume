/**
 * lib/pronosticFromProfiles.js — BLOC 2 : génère les lignes de pronostics d'un match
 * en croisant le profil DOMICILE de l'équipe qui reçoit avec le profil EXTÉRIEUR de
 * l'équipe qui se déplace — jamais une constante partagée entre matchs.
 */
import { computeMatchLinesFromProfiles } from "../lib/pronosticFromProfiles";

function field(value, { estimated = false, sampleSize = 1 } = {}) {
  if (value == null) return { value: null, estimated: true, sampleSize: 0, available: false };
  return { value, estimated, sampleSize, available: true };
}

// Profil complet, avec des chiffres nettement différents entre domicile et extérieur
// (pour vérifier que Total 1/Total 2 diffèrent réellement).
function makeProfile({
  homeGoalsFor = 2, homeGoalsAgainst = 1, awayGoalsFor = 1, awayGoalsAgainst = 1.5,
  homeCornersFor = 6, awayCornersFor = 4, homeFoulsCommitted = 10, awayFoulsCommitted = 11,
} = {}) {
  const homeSplit = {
    goalsFor: field(homeGoalsFor), goalsAgainst: field(homeGoalsAgainst),
    cornersFor: field(homeCornersFor), cornersAgainst: field(3),
    shots: field(14), shotsOnTarget: field(6),
    foulsCommitted: field(homeFoulsCommitted), foulsSuffered: field(12),
    touches: field(null),
    offsides: field(2),
    yellowCards: field(2), redCards: field(0.1),
  };
  const awaySplit = {
    goalsFor: field(awayGoalsFor), goalsAgainst: field(awayGoalsAgainst),
    cornersFor: field(awayCornersFor), cornersAgainst: field(5),
    shots: field(10), shotsOnTarget: field(4),
    foulsCommitted: field(awayFoulsCommitted), foulsSuffered: field(9),
    touches: field(null),
    offsides: field(1.5),
    yellowCards: field(2.5), redCards: field(0.05),
  };
  return { available: true, overall: homeSplit, home: homeSplit, away: awaySplit };
}

test("croise attaque domicile x défense extérieure (et réciproquement) pour les buts attendus", () => {
  const homeProfile = makeProfile({ homeGoalsFor: 2.4, homeGoalsAgainst: 0.8 });
  const awayProfile = makeProfile({ awayGoalsFor: 0.9, awayGoalsAgainst: 1.6 });
  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "Home FC", awayTeamName: "Away FC" });

  expect(lines.available).toBe(true);
  // Moyenne(attaque domicile pour=2.4, défense extérieure contre=1.6) = 2.0
  expect(lines.goals.expectedHome).toBe(2);
  // Moyenne(attaque extérieure pour=0.9, défense domicile contre=0.8) = 0.85
  expect(lines.goals.expectedAway).toBe(0.85);
});

test("génère un format « plus/moins de X,5 » (jamais un intervalle) pour Total, Total 1, Total 2", () => {
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });

  for (const market of [lines.markets.totalGoals, lines.markets.totalHome, lines.markets.totalAway]) {
    expect(market.lines[0].line % 1).toBe(0.5);
    expect(["Plus", "Moins"]).toContain(market.lines[0].side);
  }
});

test("corners/fautes : ligne match entier + ligne 1ère mi-temps, dérivée du même total réel", () => {
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });

  expect(lines.matchStats.corners.total.available).toBe(true);
  expect(lines.matchStats.corners.half.market.available).toBe(true);
  expect(lines.matchStats.corners.half.label).toBe("1ère mi-temps");
  // La ligne mi-temps découle du total réel (~46%), jamais une valeur indépendante.
  const fullLine = lines.matchStats.corners.total.line;
  const halfLine = lines.matchStats.corners.half.market.line;
  expect(halfLine).toBeLessThan(fullLine);

  expect(lines.matchStats.fouls.total.available).toBe(true);
  expect(lines.matchStats.fouls.half.market.available).toBe(true);
});

test("touches : même structure exacte que les fautes (total + mi-temps), mais toujours indisponible — aucune source ne fournit cette donnée", () => {
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });

  expect(Object.keys(lines.matchStats.touches ?? lines.matchStats.throwIns)).toEqual(
    Object.keys(lines.matchStats.fouls)
  );
  expect(lines.matchStats.throwIns.total.available).toBe(false);
  expect(lines.matchStats.throwIns.home.available).toBe(false);
  expect(lines.matchStats.throwIns.away.available).toBe(false);
  expect(lines.matchStats.throwIns.half.market.available).toBe(false);
});

test("tirs, tirs cadrés, cartons jaunes/rouges : ligne match entier uniquement (pas de mi-temps)", () => {
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });

  expect(lines.markets.shots.available).toBe(true);
  expect(lines.markets.shotsOnTarget.available).toBe(true);
  expect(lines.markets.yellowCards.available).toBe(true);
  expect(lines.markets.yellowCards.safe).toBeDefined();
  expect(lines.markets.yellowCards.risky).toBeDefined();
  expect(lines.markets.redCards.available).toBe(true);
});

test("les probabilités 1/X/2 restent des pourcentages, dans leur propre bloc — les autres lignes s'affichent en \"Plus/Moins de X,5\", jamais un pourcentage brut", () => {
  const { marketLabel, riskLabels } = require("../lib/marketFormat");
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });

  expect(lines.probabilities.home + lines.probabilities.draw + lines.probabilities.away).toBeCloseTo(100, 0);
  // components/LiveStatBlock.js et CardsAndCorners.js affichent CES fonctions, jamais
  // un champ `.confidence` brut : aucune de ces lignes ne rend un pourcentage.
  expect(marketLabel(lines.markets.totalGoals)).toMatch(/^(Plus|Moins) de \d+,5/);
  expect(marketLabel(lines.matchStats.corners.total)).toMatch(/^(Plus|Moins) de \d+,5/);
  const { safe } = riskLabels(lines.markets.yellowCards);
  expect(safe).toMatch(/^(Plus|Moins) de \d+,5/);
});

test("entre 3 et 4 scores exacts, déduits des vraies moyennes de buts des deux équipes", () => {
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });

  expect(lines.correctScores.length).toBeGreaterThanOrEqual(3);
  expect(lines.correctScores.length).toBeLessThanOrEqual(4);
});

test("deux matchs différents (profils différents) ne génèrent jamais exactement le même jeu de lignes", () => {
  const matchA = computeMatchLinesFromProfiles({
    homeProfile: makeProfile({ homeGoalsFor: 2.4, homeGoalsAgainst: 0.6, homeCornersFor: 7, homeFoulsCommitted: 8 }),
    awayProfile: makeProfile({ awayGoalsFor: 0.7, awayGoalsAgainst: 1.9, awayCornersFor: 3, awayFoulsCommitted: 13 }),
    homeTeamName: "A", awayTeamName: "B",
  });
  const matchB = computeMatchLinesFromProfiles({
    homeProfile: makeProfile({ homeGoalsFor: 1.1, homeGoalsAgainst: 1.3, homeCornersFor: 4, homeFoulsCommitted: 12 }),
    awayProfile: makeProfile({ awayGoalsFor: 1.4, awayGoalsAgainst: 1.1, awayCornersFor: 6, awayFoulsCommitted: 9 }),
    homeTeamName: "C", awayTeamName: "D",
  });

  expect(matchA.markets).not.toEqual(matchB.markets);
  expect(matchA.matchStats).not.toEqual(matchB.matchStats);
  expect(matchA.correctScores).not.toEqual(matchB.correctScores);
});

test("sans profil disponible pour une des deux équipes, honnêtement indisponible (jamais un mélange avec l'ancien modèle)", () => {
  const lines = computeMatchLinesFromProfiles({
    homeProfile: makeProfile(),
    awayProfile: { available: false },
    homeTeamName: "A", awayTeamName: "B",
  });
  expect(lines.available).toBe(false);
});

test("un champ totalement indisponible pour les deux équipes (jamais réel ni estimé) laisse la ligne honnêtement indisponible, jamais une fausse ligne « Moins de 0,5 »", () => {
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  // Simule une compétition où même les corners n'ont jamais de vraie mesure ni de
  // moyenne de repli (cas extrême, comme "touches" en pratique aujourd'hui).
  homeProfile.home.cornersFor = field(null);
  awayProfile.away.cornersAgainst = field(null);
  homeProfile.home.cornersAgainst = field(null);
  awayProfile.away.cornersFor = field(null);

  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });
  expect(lines.matchStats.corners.total.available).toBe(false);
  expect(lines.matchStats.corners.total.lines).toBeUndefined();
});

// Contexte (PROMPT 1) : les vraies confrontations directes récentes entre CES deux
// équipes (lib/headToHead.js) affinent les buts attendus déjà croisés à partir des
// profils — même mécanisme que l'ancien modèle (lib/pronostic.js#applyHeadToHead),
// jamais dupliqué ni réinventé ici.
test("avec assez de confrontations directes réelles, les buts attendus sont affinés par le H2H (h2hUsed=true)", () => {
  const homeProfile = makeProfile({ homeGoalsFor: 1.5, homeGoalsAgainst: 1 });
  const awayProfile = makeProfile({ awayGoalsFor: 1, awayGoalsAgainst: 1.2 });
  const h2h = { numberOfMatches: 5, totalGoals: 20, homeWins: 4, awayWins: 0 }; // domicile a toujours dominé, historique très prolifique

  const withoutH2h = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });
  const withH2h = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B", h2h });

  expect(withH2h.h2hUsed).toBe(true);
  expect(withoutH2h.h2hUsed).toBe(false);
  expect(withH2h.goals.expectedHome).not.toBe(withoutH2h.goals.expectedHome);
  expect(withH2h.goals.expectedAway).not.toBe(withoutH2h.goals.expectedAway);
});

test("avec trop peu de confrontations directes (moins de 3), le H2H est honnêtement ignoré (h2hUsed=false)", () => {
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  const h2h = { numberOfMatches: 2, totalGoals: 6, homeWins: 2, awayWins: 0 };

  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B", h2h });

  expect(lines.h2hUsed).toBe(false);
});

test("sans donnée H2H (h2h=null), h2hUsed est explicitement false, jamais absent", () => {
  const homeProfile = makeProfile();
  const awayProfile = makeProfile();
  const lines = computeMatchLinesFromProfiles({ homeProfile, awayProfile, homeTeamName: "A", awayTeamName: "B" });
  expect(lines.h2hUsed).toBe(false);
});
