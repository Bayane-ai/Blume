/**
 * lib/lineDuplicateCheck.js — VÉRIFICATION AUTOMATIQUE OBLIGATOIRE (BLOC 2) : deux
 * matchs différents ne doivent jamais afficher exactement le même jeu de lignes de
 * pronostics. Ce test échoue si le détecteur laisse passer un vrai doublon.
 */
import { findDuplicateLineSets, warnOnDuplicateLineSets } from "../lib/lineDuplicateCheck";

function pronostic(overrides = {}) {
  return {
    available: true,
    markets: {
      totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] },
      shots: { line: 22.5, side: "Moins", lines: [{ line: 22.5, side: "Moins" }] },
      yellowCards: { safe: { line: 3.5, side: "Moins" }, risky: { line: 5.5, side: "Moins" } },
      redCards: { safe: { line: 0.5, side: "Moins" }, risky: { line: 0.5, side: "Plus" } },
    },
    matchStats: {
      corners: { total: { line: 9.5, side: "Moins" }, home: { line: 5.5, side: "Moins" }, away: { line: 3.5, side: "Moins" }, half: { label: "1ère mi-temps", market: { line: 4.5, side: "Moins" } } },
    },
    correctScores: [{ score: "1-0", probability: 15 }, { score: "2-1", probability: 10 }, { score: "1-1", probability: 12 }],
    ...overrides,
  };
}

test("détecte deux matchs affichés avec des lignes de pronostics strictement identiques", () => {
  const matches = [
    { matchId: "1", pronostic: pronostic() },
    { matchId: "2", pronostic: pronostic() }, // même objet, structure clonée
    { matchId: "3", pronostic: pronostic({ markets: { ...pronostic().markets, totalGoals: { line: 3.5, side: "Plus", lines: [{ line: 3.5, side: "Plus" }] } } }) },
  ];

  const duplicates = findDuplicateLineSets(matches);
  expect(duplicates).toEqual([["1", "2"]]);
});

test("ne signale RIEN quand les matchs ont réellement des lignes différentes", () => {
  const matches = [
    { matchId: "1", pronostic: pronostic() },
    {
      matchId: "2",
      pronostic: pronostic({
        markets: { ...pronostic().markets, totalGoals: { line: 3.5, side: "Plus", lines: [{ line: 3.5, side: "Plus" }] } },
      }),
    },
  ];
  expect(findDuplicateLineSets(matches)).toEqual([]);
});

test("un match sans pronostic disponible n'est jamais compté comme un doublon", () => {
  const matches = [
    { matchId: "1", pronostic: pronostic() },
    { matchId: "2", pronostic: { available: false } },
    { matchId: "3", pronostic: null },
  ];
  expect(findDuplicateLineSets(matches)).toEqual([]);
});

test("détecte plusieurs paires de doublons distinctes à la fois", () => {
  const matches = [
    { matchId: "1", pronostic: pronostic() },
    { matchId: "2", pronostic: pronostic() },
    { matchId: "3", pronostic: pronostic({ correctScores: [{ score: "0-0", probability: 20 }, { score: "1-0", probability: 15 }, { score: "0-1", probability: 12 }] }) },
    { matchId: "4", pronostic: pronostic({ correctScores: [{ score: "0-0", probability: 20 }, { score: "1-0", probability: 15 }, { score: "0-1", probability: 12 }] }) },
  ];
  const duplicates = findDuplicateLineSets(matches);
  expect(duplicates).toEqual(
    expect.arrayContaining([["1", "2"], ["3", "4"]])
  );
  expect(duplicates).toHaveLength(2);
});

test("les probabilités 1X2 (bloc séparé) n'entrent pas dans la comparaison — deux matchs avec les mêmes % mais des lignes différentes ne sont jamais confondus", () => {
  const matches = [
    { matchId: "1", pronostic: pronostic({ probabilities: { home: 50, draw: 25, away: 25 } }) },
    {
      matchId: "2",
      pronostic: pronostic({
        probabilities: { home: 50, draw: 25, away: 25 },
        markets: { ...pronostic().markets, totalGoals: { line: 1.5, side: "Plus", lines: [{ line: 1.5, side: "Plus" }] } },
      }),
    },
  ];
  expect(findDuplicateLineSets(matches)).toEqual([]);
});

describe("warnOnDuplicateLineSets", () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("journalise bruyamment (console.error) dès qu'un doublon est trouvé — jamais masqué", () => {
    const matches = [
      { matchId: "1", pronostic: pronostic() },
      { matchId: "2", pronostic: pronostic() },
    ];
    const duplicates = warnOnDuplicateLineSets(matches, { context: "test" });
    expect(duplicates).toEqual([["1", "2"]]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/lineDuplicateCheck/);
  });

  test("ne journalise rien quand tout est différent", () => {
    const matches = [
      { matchId: "1", pronostic: pronostic() },
      {
        matchId: "2",
        pronostic: pronostic({ markets: { ...pronostic().markets, totalGoals: { line: 4.5, side: "Plus", lines: [{ line: 4.5, side: "Plus" }] } } }),
      },
    ];
    warnOnDuplicateLineSets(matches);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
