/**
 * lib/combinedVision.js — génération AUTOMATIQUE des combinés "Combiné Vision" (voir
 * PROMPT) : chaque ligne "assez sûre" vient d'un VRAI match (jamais inventé), jamais
 * deux lignes du même match dans un combiné, jamais de cote chiffrée — seulement une
 * confiance combinée réelle (produit des probabilités de chaque ligne).
 *
 * BLOC 2 — le pool de sélections candidates (`pronostic.selectionCandidates`) est
 * désormais calculé par lib/pronostic.js (computePronostic → buildSelectionCandidates),
 * pas par ce fichier : ces tests fournissent donc ce pool directement (comme le ferait
 * un vrai pronostic), pour tester la logique PROPRE à combinedVision.js (filtrage par
 * seuil de confiance, choix de la meilleure sélection, assemblage des combinés) —
 * indépendamment du calcul des statistiques, déjà testé dans
 * __tests__/pronostic-selection-candidates.test.js.
 */
import {
  pickLegForMatch, buildLegPool, combinedConfidence, riskLevelForLegCount,
  confidenceLabel, generateCombos,
} from "../lib/combinedVision";

function candidate(marketLabel, pickLabel, confidence) {
  return { marketLabel, pickLabel, confidence };
}

function winnerCandidate(pickLabel, confidence) {
  return candidate("Issue du match", pickLabel, confidence);
}

function pronostic(overrides = {}) {
  return {
    available: true,
    home: { name: "Arsenal FC" },
    away: { name: "Chelsea FC" },
    selectionCandidates: [winnerCandidate("Victoire Arsenal FC", 60)],
    ...overrides,
  };
}

function match(overrides = {}) {
  return {
    id: 1, status: "SCHEDULED", utcDate: "2026-01-01T15:00:00Z",
    competition: { code: "PL", name: "Premier League" },
    homeTeam: { id: 10, name: "Arsenal FC" },
    awayTeam: { id: 11, name: "Chelsea FC" },
    pronostic: pronostic(),
    ...overrides,
  };
}

describe("pickLegForMatch — la sélection la plus fiable de CE match, parmi TOUT le pool réel", () => {
  test("aucun pronostic disponible → null, jamais une ligne inventée", () => {
    expect(pickLegForMatch(match({ pronostic: { available: false } }))).toBeNull();
    expect(pickLegForMatch(match({ pronostic: null }))).toBeNull();
    expect(pickLegForMatch(null)).toBeNull();
  });

  test("pronostic sans pool de sélections (ancien instantané) → null, jamais une ligne inventée", () => {
    expect(pickLegForMatch(match({ pronostic: pronostic({ selectionCandidates: undefined }) }))).toBeNull();
  });

  test("aucune sélection du pool n'atteint son seuil de confiance → null (rien d'assez sûr)", () => {
    const m = match({
      pronostic: pronostic({
        selectionCandidates: [
          winnerCandidate("Victoire Arsenal FC", 38),
          candidate("Total", "Plus de 2,5", 52),
          candidate("Corners", "Plus de 9,5", 54),
        ],
      }),
    });
    expect(pickLegForMatch(m)).toBeNull();
  });

  test("1X2 assez sûr (>= 45 %) : choisit l'issue la plus probable, avec le bon libellé", () => {
    const m = match({ pronostic: pronostic({ selectionCandidates: [winnerCandidate("Victoire Arsenal FC", 62)] }) });
    const leg = pickLegForMatch(m);
    expect(leg.marketLabel).toBe("Issue du match");
    expect(leg.pickLabel).toBe("Victoire Arsenal FC");
    expect(leg.confidence).toBe(62);
  });

  test("marché à 2 issues assez sûr (>= 58 %), ex. Total de buts", () => {
    const m = match({ pronostic: pronostic({ selectionCandidates: [candidate("Total", "Moins de 2,5", 70)] }) });
    const leg = pickLegForMatch(m);
    expect(leg.marketLabel).toBe("Total");
    expect(leg.pickLabel).toBe("Moins de 2,5");
    expect(leg.confidence).toBe(70);
  });

  test("marché à 2 issues à 50 % (neutre) n'est PAS assez sûr même si aucun 1X2 n'est fourni", () => {
    const m = match({ pronostic: pronostic({ selectionCandidates: [candidate("Corners", "Plus de 9,5", 50)] }) });
    expect(pickLegForMatch(m)).toBeNull();
  });

  test("plusieurs sélections éligibles (corners, fautes, cartons, tirs...) : choisit celle dont la confiance réelle est la plus haute, peu importe le marché", () => {
    const m = match({
      pronostic: pronostic({
        selectionCandidates: [
          winnerCandidate("Victoire Arsenal FC", 61),
          candidate("Total", "Plus de 2,5", 59),
          candidate("Corners", "Plus de 9,5", 74.2),
          candidate("Fautes", "Moins de 21,5", 63),
          candidate("Cartons jaunes", "Plus de 3,5", 60.5),
        ],
      }),
    });
    const leg = pickLegForMatch(m);
    expect(leg.marketLabel).toBe("Corners");
    expect(leg.pickLabel).toBe("Plus de 9,5");
    expect(leg.confidence).toBe(74.2);
  });

  test("match nul le plus probable et assez sûr : \"Match nul\"", () => {
    const m = match({ pronostic: pronostic({ selectionCandidates: [winnerCandidate("Match nul", 55)] }) });
    const leg = pickLegForMatch(m);
    expect(leg.pickLabel).toBe("Match nul");
  });

  test("porte l'id du match et l'indicateur \"en direct\", pour lier chaque ligne à sa vraie source", () => {
    const m = match({ id: 42, status: "IN_PLAY" });
    const leg = pickLegForMatch(m);
    expect(leg.matchId).toBe(42);
    expect(leg.isLive).toBe(true);
    expect(leg.match).toBe(m);
  });
});

describe("buildLegPool — une ligne par match éligible, jamais deux fois le même match", () => {
  test("ignore les matchs sans ligne assez sûre, garde les autres", () => {
    const eligible = match({ id: 1 });
    const ineligible = match({ id: 2, pronostic: pronostic({ selectionCandidates: [winnerCandidate("Victoire Arsenal FC", 38)] }) });
    const pool = buildLegPool([eligible, ineligible]);
    expect(pool).toHaveLength(1);
    expect(pool[0].matchId).toBe(1);
  });

  test("dédoublonne un même id de match apparaissant deux fois (ex : présent à la fois en direct et à venir)", () => {
    const pool = buildLegPool([match({ id: 7 }), match({ id: 7 })]);
    expect(pool).toHaveLength(1);
  });
});

describe("combinedConfidence — le VRAI produit des probabilités de chaque ligne", () => {
  test("2 lignes à 60 % et 50 % → confiance combinée 30 %", () => {
    expect(combinedConfidence([{ confidence: 60 }, { confidence: 50 }])).toBe(30);
  });

  test("plus de lignes ajoutées → confiance combinée qui chute mécaniquement", () => {
    const two = combinedConfidence([{ confidence: 60 }, { confidence: 60 }]);
    const three = combinedConfidence([{ confidence: 60 }, { confidence: 60 }, { confidence: 60 }]);
    expect(three).toBeLessThan(two);
  });
});

describe("riskLevelForLegCount / confidenceLabel", () => {
  test("1 ou 2 lignes -> faible ; 3 lignes -> moyen ; 4+ -> élevé", () => {
    expect(riskLevelForLegCount(1)).toBe("faible");
    expect(riskLevelForLegCount(2)).toBe("faible");
    expect(riskLevelForLegCount(3)).toBe("moyen");
    expect(riskLevelForLegCount(4)).toBe("eleve");
    expect(riskLevelForLegCount(5)).toBe("eleve");
  });

  test("étiquette de confiance qualitative dérivée du vrai pourcentage", () => {
    expect(confidenceLabel(35)).toBe("Élevée");
    expect(confidenceLabel(15)).toBe("Moyenne");
    expect(confidenceLabel(5)).toBe("Faible");
  });
});

describe("generateCombos — assemble les combinés à partir des VRAIS matchs chargés", () => {
  function manyMatches(count, overrides = {}) {
    return Array.from({ length: count }, (_, i) =>
      match({ id: i + 1, homeTeam: { id: 100 + i, name: `Home ${i}` }, awayTeam: { id: 200 + i, name: `Away ${i}` }, ...overrides })
    );
  }

  test("moins de 2 lignes éligibles au total : aucun combiné, jamais un combiné à moitié inventé", () => {
    expect(generateCombos([])).toEqual([]);
    expect(generateCombos(manyMatches(1))).toEqual([]);
  });

  test("avec assez de matchs, propose plusieurs combinés peu/moyennement risqués", () => {
    const combos = generateCombos(manyMatches(6), { random: () => 0.9 }); // random élevé -> jamais le combiné risqué
    expect(combos.length).toBeGreaterThanOrEqual(2);
    for (const combo of combos) {
      expect(["faible", "moyen", "eleve"]).toContain(combo.riskLevel);
      expect(combo.legs.length).toBeGreaterThanOrEqual(2);
      // Jamais deux lignes du même match dans un même combiné.
      const ids = combo.legs.map((l) => l.matchId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("avec un random toujours en dessous du seuil et assez de matchs, inclut un combiné très risqué (rare, jamais garanti)", () => {
    const combos = generateCombos(manyMatches(8), { random: () => 0.01 });
    expect(combos.some((c) => c.riskLevel === "eleve")).toBe(true);
  });

  test("avec un random toujours au-dessus du seuil, aucun combiné très risqué (\"proposés rarement, pas trop souvent\")", () => {
    const combos = generateCombos(manyMatches(8), { random: () => 0.99 });
    expect(combos.every((c) => c.riskLevel !== "eleve")).toBe(true);
  });

  test("sans aucun match en direct dans le pool : aucun combiné marqué \"En live\"", () => {
    const combos = generateCombos(manyMatches(6, { status: "SCHEDULED" }));
    expect(combos.every((c) => c.isLive === false)).toBe(true);
  });

  test("avec au moins un match en direct assez sûr : un combiné \"En live\" apparaît, avec au moins une ligne réellement en direct", () => {
    const matches = [...manyMatches(3, { status: "SCHEDULED" }), match({ id: 99, status: "IN_PLAY", homeTeam: { id: 900, name: "Live Home" }, awayTeam: { id: 901, name: "Live Away" } })];
    const combos = generateCombos(matches);
    const liveCombo = combos.find((c) => c.isLive);
    expect(liveCombo).toBeDefined();
    expect(liveCombo.legs.some((l) => l.isLive)).toBe(true);
  });

  // BLOC 3 — les opportunités live "peu/moyennement risquées peuvent revenir
  // régulièrement" (2-3 lignes, comme le combiné pré-match) ; "les très risquées
  // restent rares", mais pas impossibles : un combiné live doit pouvoir, de temps en
  // temps, atteindre le niveau "très risqué" (4+ lignes), avec la même rareté que le
  // combiné pré-match très risqué (voir PROMPT bloc 3).
  test("un combiné \"En live\" peut, rarement, être \"très risqué\" quand le pool le permet et que le tirage aléatoire l'autorise", () => {
    const matches = [...manyMatches(6, { status: "SCHEDULED" }), match({ id: 99, status: "IN_PLAY", homeTeam: { id: 900, name: "Live Home" }, awayTeam: { id: 901, name: "Live Away" } })];
    const combos = generateCombos(matches, { random: () => 0.01 });
    const liveCombo = combos.find((c) => c.isLive);
    expect(liveCombo).toBeDefined();
    expect(liveCombo.riskLevel).toBe("eleve");
    expect(liveCombo.legs.length).toBeGreaterThanOrEqual(4);
  });

  test("avec un random toujours au-dessus du seuil, le combiné \"En live\" reste peu/moyennement risqué (jamais \"très risqué\" à chaque fois)", () => {
    const matches = [...manyMatches(6, { status: "SCHEDULED" }), match({ id: 99, status: "IN_PLAY", homeTeam: { id: 900, name: "Live Home" }, awayTeam: { id: 901, name: "Live Away" } })];
    const combos = generateCombos(matches, { random: () => 0.99 });
    const liveCombo = combos.find((c) => c.isLive);
    expect(liveCombo).toBeDefined();
    expect(liveCombo.riskLevel).not.toBe("eleve");
    expect(liveCombo.legs.length).toBeLessThanOrEqual(3);
  });

  test("des matchs avec des sélections de marchés différents (corners, fautes, cartons, 1X2...) alimentent le même combiné", () => {
    const matches = [
      match({ id: 1, pronostic: pronostic({ selectionCandidates: [winnerCandidate("Victoire Home 0", 61)] }) }),
      match({ id: 2, pronostic: pronostic({ selectionCandidates: [candidate("Corners", "Plus de 9,5", 65)] }) }),
      match({ id: 3, pronostic: pronostic({ selectionCandidates: [candidate("Fautes", "Moins de 21,5", 63)] }) }),
      match({ id: 4, pronostic: pronostic({ selectionCandidates: [candidate("Cartons jaunes", "Plus de 3,5", 70)] }) }),
    ];
    const combos = generateCombos(matches, { random: () => 0.9 });
    const marketLabels = new Set(combos.flatMap((c) => c.legs.map((l) => l.marketLabel)));
    // Au moins deux marchés différents apparaissent bien parmi les combinés générés —
    // pas toujours la même sélection répétée (voir PROMPT "Variété").
    expect(marketLabels.size).toBeGreaterThanOrEqual(2);
  });

  test("jamais de cote chiffrée dans les données renvoyées (aucun champ \"odds\"/\"cote\")", () => {
    const combos = generateCombos(manyMatches(6));
    for (const combo of combos) {
      expect(combo.odds).toBeUndefined();
      expect(JSON.stringify(combo)).not.toMatch(/\bcote\b/i);
    }
  });
});
