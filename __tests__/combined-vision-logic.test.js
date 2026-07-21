/**
 * lib/combinedVision.js — génération AUTOMATIQUE des combinés "Combiné Vision" (voir
 * PROMPT) : chaque ligne "assez sûre" vient d'un VRAI match (jamais inventé), jamais
 * deux lignes du même match dans un combiné, jamais de cote chiffrée — seulement une
 * confiance combinée réelle (produit des probabilités de chaque ligne).
 */
import {
  pickLegForMatch, buildLegPool, combinedConfidence, riskLevelForLegCount,
  confidenceLabel, generateCombos,
} from "../lib/combinedVision";

function pronostic(overrides = {}) {
  return {
    available: true,
    home: { name: "Arsenal FC" },
    away: { name: "Chelsea FC" },
    probabilities: { home: 60, draw: 25, away: 15 },
    goals: { over25: 55, under25: 45 },
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

describe("pickLegForMatch — UNE ligne assez sûre par match, entre le 1X2 et le Total 2,5 buts", () => {
  test("aucun pronostic disponible → null, jamais une ligne inventée", () => {
    expect(pickLegForMatch(match({ pronostic: { available: false } }))).toBeNull();
    expect(pickLegForMatch(match({ pronostic: null }))).toBeNull();
    expect(pickLegForMatch(null)).toBeNull();
  });

  test("ni le 1X2 ni le Total n'atteignent leur seuil de confiance → null (rien d'assez sûr)", () => {
    const m = match({ pronostic: pronostic({ probabilities: { home: 38, draw: 33, away: 29 }, goals: { over25: 52, under25: 48 } }) });
    expect(pickLegForMatch(m)).toBeNull();
  });

  test("1X2 assez sûr (>= 45 %) : choisit l'issue la plus probable, avec le bon libellé", () => {
    const m = match({ pronostic: pronostic({ probabilities: { home: 62, draw: 20, away: 18 }, goals: { over25: 50, under25: 50 } }) });
    const leg = pickLegForMatch(m);
    expect(leg.marketLabel).toBe("Issue du match");
    expect(leg.pickLabel).toBe("Victoire Arsenal FC");
    expect(leg.confidence).toBe(62);
  });

  test("Total assez sûr (>= 58 %) : choisit Plus/Moins de 2,5 buts selon le sens le plus probable", () => {
    const m = match({ pronostic: pronostic({ probabilities: { home: 40, draw: 32, away: 28 }, goals: { over25: 30, under25: 70 } }) });
    const leg = pickLegForMatch(m);
    expect(leg.marketLabel).toBe("Total de buts");
    expect(leg.pickLabel).toBe("Moins de 2,5 buts");
    expect(leg.confidence).toBe(70);
  });

  test("les deux marchés sont éligibles : choisit celui dont la confiance réelle est la plus haute", () => {
    const m = match({ pronostic: pronostic({ probabilities: { home: 46, draw: 30, away: 24 }, goals: { over25: 80, under25: 20 } }) });
    const leg = pickLegForMatch(m);
    expect(leg.pickLabel).toBe("Plus de 2,5 buts");
    expect(leg.confidence).toBe(80);
  });

  test("match nul le plus probable et assez sûr : \"Match nul\"", () => {
    const m = match({ pronostic: pronostic({ probabilities: { home: 20, draw: 55, away: 25 }, goals: { over25: 50, under25: 50 } }) });
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
    const ineligible = match({ id: 2, pronostic: pronostic({ probabilities: { home: 38, draw: 33, away: 29 }, goals: { over25: 52, under25: 48 } }) });
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

  test("jamais de cote chiffrée dans les données renvoyées (aucun champ \"odds\"/\"cote\")", () => {
    const combos = generateCombos(manyMatches(6));
    for (const combo of combos) {
      expect(combo.odds).toBeUndefined();
      expect(JSON.stringify(combo)).not.toMatch(/\bcote\b/i);
    }
  });
});
