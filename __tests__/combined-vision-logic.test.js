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
  confidenceLabel, generateCombos, LEG_COUNT_RANGES,
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

  // Cartons jaunes/rouges sont des événements rares : leur ligne "sûre" atteint donc
  // structurellement une confiance plus haute que les autres marchés — sans traitement
  // particulier, ils domineraient presque tous les combinés (voir PROMPT : "les
  // combinés sont composés presque uniquement de pronostics cartons, ce n'est pas ce
  // qu'on veut"). Un autre marché éligible doit donc toujours être préféré aux cartons,
  // même moins confiant.
  test("un carton plus confiant qu'un autre marché éligible : l'autre marché est quand même préféré", () => {
    const m = match({
      pronostic: pronostic({
        selectionCandidates: [
          candidate("Cartons rouges", "Plus de 0,5", 92),
          candidate("Corners", "Plus de 9,5", 64),
        ],
      }),
    });
    const leg = pickLegForMatch(m);
    expect(leg.marketLabel).toBe("Corners");
  });

  test("les cartons sont le SEUL marché éligible de ce match : retenus en dernier recours", () => {
    const m = match({
      pronostic: pronostic({
        selectionCandidates: [
          candidate("Cartons jaunes", "Plus de 3,5", 65),
          candidate("Corners", "Plus de 9,5", 50), // sous le seuil (50 % = neutre)
        ],
      }),
    });
    const leg = pickLegForMatch(m);
    expect(leg.marketLabel).toBe("Cartons jaunes");
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

  test("porte la justification et la métadonnée de vérification de la sélection choisie (BLOC 4.A/B)", () => {
    const m = match({
      pronostic: pronostic({
        selectionCandidates: [{ marketLabel: "Issue du match", pickLabel: "Victoire Arsenal FC", confidence: 62, reason: "Raison réelle X", verify: { type: "winner", key: "home" } }],
      }),
    });
    const leg = pickLegForMatch(m);
    expect(leg.reason).toBe("Raison réelle X");
    expect(leg.verify).toEqual({ type: "winner", key: "home" });
  });
});

// BLOC 4.C — horizon (matchs du jour et des prochaines 24-48h) et fiabilité des
// statistiques (ligues avec trop peu de données ignorées).
describe("BLOC 4.C — horizon (24-48h) et fiabilité des statistiques", () => {
  test("un match programmé dans plus de 48h est ignoré (hors horizon)", () => {
    const tooFar = match({ utcDate: new Date(Date.now() + 72 * 3600000).toISOString() });
    expect(pickLegForMatch(tooFar)).toBeNull();
  });

  test("un match programmé dans moins de 48h reste éligible", () => {
    const soon = match({ utcDate: new Date(Date.now() + 30 * 3600000).toISOString() });
    expect(pickLegForMatch(soon)).not.toBeNull();
  });

  test("un match déjà en direct est toujours dans l'horizon, quelle que soit sa date de coup d'envoi d'origine", () => {
    const stillLive = match({ status: "IN_PLAY", utcDate: new Date(Date.now() - 96 * 3600000).toISOString() });
    expect(pickLegForMatch(stillLive)).not.toBeNull();
  });

  test("une équipe sans classement/forme réelle (estimation moyenne, stats pas assez fiables) exclut le match", () => {
    const unreliable = match({ pronostic: pronostic({ home: { name: "Arsenal FC", source: "estimation moyenne" } }) });
    expect(pickLegForMatch(unreliable)).toBeNull();
  });

  test("les deux équipes ont des stats fiables : le match reste éligible", () => {
    const reliable = match({ pronostic: pronostic({ home: { name: "Arsenal FC", source: "classement" }, away: { name: "Chelsea FC", source: "forme récente" } }) });
    expect(pickLegForMatch(reliable)).not.toBeNull();
  });
});

// BLOC 4.D — une sélection "En live" qui tourne mal doit être marquée "compromise".
describe("BLOC 4.D — sélection live compromise", () => {
  function liveMatch(overrides = {}) {
    return match({
      status: "IN_PLAY",
      minute: 80,
      score: { fullTime: { home: 0, away: 1 } },
      pronostic: pronostic({
        selectionCandidates: [{ marketLabel: "Issue du match", pickLabel: "Victoire Arsenal FC", confidence: 60, verify: { type: "winner", key: "home" } }],
      }),
      ...overrides,
    });
  }

  test("équipe pariée menée tard dans le match : sélection marquée compromise", () => {
    const leg = pickLegForMatch(liveMatch());
    expect(leg.compromised).toBe(true);
  });

  test("équipe pariée qui mène : jamais compromise", () => {
    const leg = pickLegForMatch(liveMatch({ score: { fullTime: { home: 2, away: 0 } } }));
    expect(leg.compromised).toBe(false);
  });

  test("encore tôt dans le match (avant la 75e minute) : pas encore jugée compromise, même menée", () => {
    const leg = pickLegForMatch(liveMatch({ minute: 40 }));
    expect(leg.compromised).toBe(false);
  });

  test("un match pas encore commencé n'est jamais compromis (pas une sélection live)", () => {
    const leg = pickLegForMatch(match());
    expect(leg.compromised).toBe(false);
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

// BLOC 4.A — nouvelles plages par niveau de risque : peu risqué 2-3, moyennement
// risqué 3-4, très risqué 5-7 (plages volontairement chevauchantes à 3, voir PROMPT).
// riskLevelForLegCount reste une approximation "au plus petit niveau dont la plage
// contient ce nombre" : la génération elle-même (generateCombos) fixe le niveau visé
// explicitement, sans dépendre de cette relecture après coup (voir lib/combinedVision.js).
describe("riskLevelForLegCount / confidenceLabel", () => {
  test("2-3 lignes -> faible ; 4 lignes -> moyen ; 5-7 lignes -> élevé", () => {
    expect(riskLevelForLegCount(1)).toBe("faible");
    expect(riskLevelForLegCount(2)).toBe("faible");
    expect(riskLevelForLegCount(3)).toBe("faible");
    expect(riskLevelForLegCount(4)).toBe("moyen");
    expect(riskLevelForLegCount(5)).toBe("eleve");
    expect(riskLevelForLegCount(6)).toBe("eleve");
    expect(riskLevelForLegCount(7)).toBe("eleve");
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

  // BLOC 5 — "Combiné mixte" : un même combiné peut contenir à la fois des matchs en
  // direct et des matchs à venir. `isLive` doit se déduire des VRAIES lignes qui le
  // composent, même pour un combiné "ordinaire" (pas le combiné live dédié) qui pioche
  // par hasard une ligne en direct dans le pool mixte.
  test("un combiné ordinaire qui pioche à la fois un match en direct et des matchs à venir est bien marqué \"En live\" (combiné mixte)", () => {
    // Pool réduit à 3 lignes (1 en direct + 2 à venir) et plage "faible"/"moyen"
    // forcées à leur maximum (3 lignes) : le tirage ne peut alors porter QUE sur ces
    // 3 lignes, forcément mixte.
    const matches = [
      ...manyMatches(2, { status: "SCHEDULED" }),
      match({ id: 99, status: "IN_PLAY", homeTeam: { id: 900, name: "Live Home" }, awayTeam: { id: 901, name: "Live Away" } }),
    ];
    const combos = generateCombos(matches, { random: () => 0.99 });
    expect(combos.length).toBeGreaterThan(0);
    const mixedCombo = combos[0];
    expect(mixedCombo.legs).toHaveLength(3);
    expect(mixedCombo.legs.some((l) => l.isLive)).toBe(true);
    expect(mixedCombo.legs.some((l) => !l.isLive)).toBe(true);
    expect(mixedCombo.isLive).toBe(true);
  });

  test("l'indicateur \"isLive\" d'un combiné correspond toujours exactement à la présence d'au moins une ligne en direct parmi ses sélections", () => {
    const matches = [...manyMatches(6, { status: "SCHEDULED" }), match({ id: 99, status: "IN_PLAY", homeTeam: { id: 900, name: "Live Home" }, awayTeam: { id: 901, name: "Live Away" } })];
    const combos = generateCombos(matches, { random: () => 0.5 });
    for (const combo of combos) {
      expect(combo.isLive).toBe(combo.legs.some((l) => l.isLive));
    }
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

  // BLOC 4.A — le nombre de sélections d'un combiné respecte toujours la plage de son
  // niveau de risque affiché (voir LEG_COUNT_RANGES).
  test("chaque combiné respecte la plage de sélections de son niveau de risque affiché", () => {
    const combos = generateCombos(manyMatches(10), { random: () => 0.01 }); // favorise le combiné très risqué
    for (const combo of combos) {
      const [min, max] = LEG_COUNT_RANGES[combo.riskLevel];
      expect(combo.legs.length).toBeGreaterThanOrEqual(min);
      expect(combo.legs.length).toBeLessThanOrEqual(max);
    }
  });

  // BLOC 4.D — un combiné "En live" avec une sélection compromise est bien marqué
  // comme tel, et n'est plus proposé comme une opportunité "fraîche".
  test("un combiné \"En live\" avec une sélection compromise est marqué compromis", () => {
    const compromisedLiveMatch = match({
      id: 99, status: "IN_PLAY", minute: 85, score: { fullTime: { home: 0, away: 2 } },
      homeTeam: { id: 900, name: "Live Home" }, awayTeam: { id: 901, name: "Live Away" },
      pronostic: pronostic({
        selectionCandidates: [{ marketLabel: "Issue du match", pickLabel: "Victoire Live Home", confidence: 60, verify: { type: "winner", key: "home" } }],
      }),
    });
    const matches = [...manyMatches(3, { status: "SCHEDULED" }), compromisedLiveMatch];
    const combos = generateCombos(matches);
    const liveCombo = combos.find((c) => c.isLive);
    expect(liveCombo.compromised).toBe(true);
  });

  test("un combiné \"En live\" sans sélection compromise n'est pas marqué compromis", () => {
    const matches = [...manyMatches(3, { status: "SCHEDULED" }), match({ id: 99, status: "IN_PLAY", homeTeam: { id: 900, name: "Live Home" }, awayTeam: { id: 901, name: "Live Away" } })];
    const combos = generateCombos(matches);
    const liveCombo = combos.find((c) => c.isLive);
    expect(liveCombo.compromised).toBe(false);
  });

  // Rareté des cartons dans les combinés (voir PROMPT : "les pronostics cartons ne
  // doivent apparaître que RAREMENT : au maximum 1 sélection carton par combiné, et
  // seulement dans une minorité de combinés").
  describe("rareté des cartons", () => {
    function cartonsOnlyMatches(count) {
      return Array.from({ length: count }, (_, i) =>
        match({
          id: i + 1,
          homeTeam: { id: 100 + i, name: `Home ${i}` },
          awayTeam: { id: 200 + i, name: `Away ${i}` },
          pronostic: pronostic({ selectionCandidates: [candidate("Cartons jaunes", "Plus de 3,5", 65)] }),
        })
      );
    }

    function mixedMatches() {
      const nonCartons = Array.from({ length: 8 }, (_, i) =>
        match({
          id: i + 1,
          homeTeam: { id: 100 + i, name: `Home ${i}` },
          awayTeam: { id: 200 + i, name: `Away ${i}` },
          pronostic: pronostic({ selectionCandidates: [candidate("Corners", "Plus de 9,5", 60 + i)] }),
        })
      );
      const cartons = Array.from({ length: 4 }, (_, i) =>
        match({
          id: 900 + i,
          homeTeam: { id: 900 + i, name: `Cartons Home ${i}` },
          awayTeam: { id: 950 + i, name: `Cartons Away ${i}` },
          pronostic: pronostic({ selectionCandidates: [candidate("Cartons rouges", "Plus de 0,5", 90)] }),
        })
      );
      return [...nonCartons, ...cartons];
    }

    test("pool entièrement composé de cartons : jamais de combiné inventé en dépassant la limite d'une sélection carton (aucun combiné plutôt qu'une règle violée)", () => {
      // Avec la règle "au maximum 1 sélection carton par combiné", un pool qui n'offre
      // AUCUN autre marché ne permet d'assembler un combiné de 2+ lignes en respectant
      // cette limite — le comportement honnête est de ne rien proposer (voir BLOC 4.D,
      // "aucun combiné fiable disponible : ne rien forcer"), jamais d'assouplir la
      // règle pour remplir un ticket.
      const combos = generateCombos(cartonsOnlyMatches(10), { random: () => 0.01 }); // random bas -> autoriserait les cartons si possible
      for (const combo of combos) {
        const cartonsCount = combo.legs.filter((l) => l.marketLabel.startsWith("Cartons")).length;
        expect(cartonsCount).toBeLessThanOrEqual(1);
      }
      expect(combos).toEqual([]);
    });

    test("pool majoritairement cartons avec quelques matchs non-cartons : jamais plus d'une sélection carton par combiné", () => {
      const matches = [
        ...cartonsOnlyMatches(8),
        match({
          id: 501, homeTeam: { id: 501, name: "Home A" }, awayTeam: { id: 601, name: "Away A" },
          pronostic: pronostic({ selectionCandidates: [candidate("Corners", "Plus de 9,5", 65)] }),
        }),
        match({
          id: 502, homeTeam: { id: 502, name: "Home B" }, awayTeam: { id: 602, name: "Away B" },
          pronostic: pronostic({ selectionCandidates: [candidate("Fautes", "Moins de 21,5", 63)] }),
        }),
      ];
      const combos = generateCombos(matches, { random: () => 0.01 }); // random bas -> autorise les cartons quand la règle le permet
      expect(combos.length).toBeGreaterThan(0);
      for (const combo of combos) {
        const cartonsCount = combo.legs.filter((l) => l.marketLabel.startsWith("Cartons")).length;
        expect(cartonsCount).toBeLessThanOrEqual(1);
      }
    });

    test("aucun combiné n'est composé à 100% de cartons quand un pool suffisant d'autres marchés existe", () => {
      const combos = generateCombos(mixedMatches(), { random: () => 0.01 }); // random bas -> autorise même les cartons
      expect(combos.length).toBeGreaterThan(0);
      for (const combo of combos) {
        expect(combo.legs.some((l) => !l.marketLabel.startsWith("Cartons"))).toBe(true);
      }
    });

    test("random au-dessus du seuil cartons : aucun combiné n'inclut de carton quand un pool suffisant d'autres marchés existe", () => {
      const combos = generateCombos(mixedMatches(), { random: () => 0.99 });
      expect(combos.length).toBeGreaterThan(0);
      for (const combo of combos) {
        expect(combo.legs.every((l) => !l.marketLabel.startsWith("Cartons"))).toBe(true);
      }
    });

    test("la ligne live garantie privilégie un marché non-cartons quand une alternative existe pour ce match", () => {
      const matches = [
        ...manyMatches(3, { status: "SCHEDULED" }),
        match({
          id: 99, status: "IN_PLAY",
          homeTeam: { id: 900, name: "Live Home" }, awayTeam: { id: 901, name: "Live Away" },
          pronostic: pronostic({
            selectionCandidates: [
              candidate("Cartons rouges", "Plus de 0,5", 90),
              candidate("Corners", "Plus de 9,5", 65),
            ],
          }),
        }),
      ];
      const combos = generateCombos(matches);
      const liveCombo = combos.find((c) => c.isLive);
      const liveLeg = liveCombo.legs.find((l) => l.matchId === 99);
      expect(liveLeg.marketLabel).toBe("Corners");
    });

    test("sur de nombreuses générations d'un pool mixte, les cartons n'apparaissent que dans une minorité de combinés", () => {
      const matches = mixedMatches();
      let totalCombos = 0;
      let combosWithCartons = 0;
      let seed = 1;
      // Générateur pseudo-aléatoire déterministe (LCG) pour simuler de nombreux tirages
      // reproductibles, sans dépendre de Math.random dans un test.
      function nextRandom() {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      }
      for (let i = 0; i < 60; i++) {
        const combos = generateCombos(matches, { random: nextRandom });
        totalCombos += combos.length;
        combosWithCartons += combos.filter((c) => c.legs.some((l) => l.marketLabel.startsWith("Cartons"))).length;
      }
      expect(totalCombos).toBeGreaterThan(0);
      expect(combosWithCartons).toBeLessThan(totalCombos * 0.5);
    });
  });
});
