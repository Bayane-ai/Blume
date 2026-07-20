/**
 * lib/pronostic.js — le bloc Total (buts) affiche une seule ligne quand le modèle est
 * confiant, et une marge de deux lignes voisines (ex. "Plus de 2,5 (ou 3,5)") quand
 * l'issue réelle (probabilité calculée sur la vraie distribution de Poisson) est trop
 * proche de 50 % pour un seul chiffre. Les tirs (seul marché sans double option sûre/
 * risquée) restent toujours sur une seule ligne. Cartons jaunes/cartons rouges ont leur
 * propre mécanisme à deux lignes (sûre + risquée, voir riskLines) — testé dans
 * cards-and-corners.test.jsx. Les corners ont leur propre bloc dédié (Total match +
 * mi-temps, recalculé en direct) — voir live-stat-block.test.js.
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

test("le marché sans double option (tirs) n'a jamais de marge, même quand le Total en a une", () => {
  for (let goalsFor = 14; goalsFor <= 60; goalsFor += 4) {
    const result = computePronostic({
      homeRow: row({ id: 1, goalsFor, goalsAgainst: 30 }),
      awayRow: row({ id: 2, goalsFor: 30, goalsAgainst: goalsFor }),
      homeTeamName: "A", awayTeamName: "B",
    });
    expect(result.markets.shots.lines).toHaveLength(1);
  }
});

test("cartons jaunes/cartons rouges affichent toujours une option sûre ET une option risquée, distinctes l'une de l'autre", () => {
  for (let goalsFor = 14; goalsFor <= 60; goalsFor += 4) {
    const result = computePronostic({
      homeRow: row({ id: 1, goalsFor, goalsAgainst: 30 }),
      awayRow: row({ id: 2, goalsFor: 30, goalsAgainst: goalsFor }),
      homeTeamName: "A", awayTeamName: "B",
    });
    for (const key of ["yellowCards", "redCards"]) {
      const market = result.markets[key];
      expect(market.safe.side).toMatch(/^Plus|Moins$/);
      expect(market.risky.side).toMatch(/^Plus|Moins$/);
      expect(market.safe.line % 1).toBeCloseTo(0.5, 5);
      expect(market.risky.line % 1).toBeCloseTo(0.5, 5);
      expect(`${market.safe.side}${market.safe.line}`).not.toBe(`${market.risky.side}${market.risky.line}`);
    }
  }
});

// Régression : les lignes de cartons jaunes étaient dérivées d'un seuil de confiance
// fixe (recherche sur la loi de Poisson), qui produisait de larges "paliers" — beaucoup
// de matchs à l'intensité totale proche mais au rapport de force différent retombaient
// alors sur EXACTEMENT le même couple de lignes. Remplacé par un écart continu (écart-
// type réel de la distribution, voir riskLines/spreadLine dans lib/pronostic.js) : sur
// un lot de profils d'équipes assez variés, la grande majorité doivent désormais
// afficher des lignes distinctes, pas la même poignée de couples recopiée partout.
test("sur un lot de profils d'équipes variés, les cartons jaunes affichent des lignes distinctes dans la grande majorité des cas — jamais un petit nombre de couples recopiés partout", () => {
  const profiles = [];
  for (let homeGoalsFor = 15; homeGoalsFor <= 60; homeGoalsFor += 5) {
    for (let awayGoalsAgainst = 15; awayGoalsAgainst <= 45; awayGoalsAgainst += 15) {
      profiles.push({ homeGoalsFor, awayGoalsAgainst });
    }
  }

  const results = profiles.map(({ homeGoalsFor, awayGoalsAgainst }, i) => {
    const result = computePronostic({
      homeRow: row({ id: i * 2, goalsFor: homeGoalsFor, goalsAgainst: 25 }),
      awayRow: row({ id: i * 2 + 1, goalsFor: 30, goalsAgainst: awayGoalsAgainst }),
      homeTeamName: "A", awayTeamName: "B",
    });
    return result.markets;
  });

  for (const key of ["yellowCards"]) {
    const distinctLines = new Set(results.map((m) => `${m[key].safe.side}${m[key].safe.line}/${m[key].risky.side}${m[key].risky.line}`));
    // Repère de non-régression : avant le passage à un écart continu, ce lot de
    // profils (volontairement dense — des équipes très proches y sont attendues, donc
    // certains couples se recoupent légitimement) ne produisait qu'une poignée de
    // couples de lignes recopiés partout. Le seuil ci-dessous vérifie que ce n'est
    // plus le cas, sans exiger l'impossible (zéro coïncidence entre équipes proches).
    expect(distinctLines.size).toBeGreaterThan(results.length * 0.35);
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
