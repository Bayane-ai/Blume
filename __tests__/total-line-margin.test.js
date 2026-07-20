/**
 * lib/pronostic.js — le bloc Total (buts) affiche une seule ligne quand le modèle est
 * confiant, et une marge de deux lignes voisines (ex. "Plus de 2,5 (ou 3,5)") quand
 * l'issue réelle (probabilité calculée sur la vraie distribution de Poisson) est trop
 * proche de 50 % pour un seul chiffre — jamais pour les autres marchés (corners/tirs/
 * cartons), qui n'ont pas de distribution dédiée pour évaluer cette confiance.
 */
import { computePronostic } from "../lib/pronostic";
import { marketLabel } from "../lib/marketFormat";

function row({ id, goalsFor, goalsAgainst, playedGames = 20 }) {
  return { position: 5, points: 30, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

// Balaye une large plage de profils d'équipes réalistes : la ligne retenue pour le
// Total (buts attendus proches ou éloignés du seuil le plus proche, selon les cas)
// doit produire À LA FOIS des cas confiants (une seule ligne) ET des cas incertains
// (une marge de deux lignes) — jamais systématiquement l'un ou l'autre.
function scanTotalMarkets() {
  const results = [];
  for (let goalsFor = 14; goalsFor <= 60; goalsFor += 2) {
    const result = computePronostic({
      homeRow: row({ id: 1, goalsFor, goalsAgainst: 30 }),
      awayRow: row({ id: 2, goalsFor: 30, goalsAgainst: goalsFor }),
      homeTeamName: "A", awayTeamName: "B",
    });
    results.push(result.markets.totalGoals);
  }
  return results;
}

test("le Total affiche à la fois des cas confiants (une seule ligne) et des cas incertains (une marge de deux lignes) selon le profil du match", () => {
  const markets = scanTotalMarkets();
  expect(markets.some((m) => m.lines.length === 1)).toBe(true);
  expect(markets.some((m) => m.lines.length === 2)).toBe(true);
});

test("les marchés sans distribution dédiée (corners/tirs/cartons jaunes) n'ont jamais de marge, même quand le Total en a une", () => {
  for (let goalsFor = 14; goalsFor <= 60; goalsFor += 4) {
    const result = computePronostic({
      homeRow: row({ id: 1, goalsFor, goalsAgainst: 30 }),
      awayRow: row({ id: 2, goalsFor: 30, goalsAgainst: goalsFor }),
      homeTeamName: "A", awayTeamName: "B",
    });
    expect(result.markets.corners.lines).toHaveLength(1);
    expect(result.markets.shots.lines).toHaveLength(1);
    expect(result.markets.yellowCards.lines).toHaveLength(1);
  }
});

test("quand une marge est affichée, la deuxième ligne est adjacente à la première et dans le MÊME sens (jamais Plus et Moins mélangés)", () => {
  let foundMargin = false;
  for (const market of scanTotalMarkets()) {
    if (market.lines.length === 2) {
      foundMargin = true;
      const [first, second] = market.lines;
      expect(second.side).toBe(first.side);
      expect(Math.abs(second.line - first.line)).toBe(1);
    }
  }
  expect(foundMargin).toBe(true);
});

test("marketLabel (lib/marketFormat.js) affiche une seule ligne ou les deux selon le cas, jamais de cote", () => {
  expect(marketLabel({ lines: [{ line: 2.5, side: "Plus" }] })).toBe("Plus de 2,5");
  expect(marketLabel({ lines: [{ line: 2.5, side: "Plus" }, { line: 3.5, side: "Plus" }] })).toBe("Plus de 2,5 (ou 3,5)");
  expect(marketLabel(null)).toBe("–");
  expect(marketLabel({ lines: [] })).toBe("–");
});
