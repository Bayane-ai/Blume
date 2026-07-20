/**
 * @jest-environment jsdom
 *
 * components/CardsAndCorners.js — bloc "Cartons", en bas de la page de pronostics :
 * pour cartons jaunes et cartons rouges, deux options "Plus/Moins de X,5" (une sûre,
 * une risquée — voir lib/pronostic.js, riskLines), et les vrais joueurs les plus
 * sujets aux cartons cette saison (best-effort, API-Football) — jamais un joueur
 * inventé. Les corners ont leur propre bloc dédié, voir live-stat-block.test.jsx.
 */
import { render, screen, within } from "@testing-library/react";
import CardsAndCorners from "../components/CardsAndCorners";
import { computePronostic } from "../lib/pronostic";

function row({ id, goalsFor, goalsAgainst, playedGames = 20 }) {
  return { position: 5, points: 30, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

function basePronostic(overrides = {}) {
  const pronostic = computePronostic({
    homeRow: row({ id: 1, goalsFor: 45, goalsAgainst: 20 }),
    awayRow: row({ id: 2, goalsFor: 30, goalsAgainst: 28 }),
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
  });
  return { ...pronostic, ...overrides };
}

const OPTION_PATTERN = /Sûr (Plus|Moins) de \d+,5.*Risqué (Plus|Moins) de \d+,5/s;

test("cartons jaunes affichent une option sûre et une option risquée, en Plus/Moins de X,5, jamais une cote", () => {
  render(<CardsAndCorners pronostic={basePronostic()} />);
  expect(screen.getByTestId("market-yellow-cards")).toHaveTextContent(OPTION_PATTERN);
});

test("le carton rouge suit le même format sûr/risqué en Plus/Moins de X,5 (pas une probabilité)", () => {
  render(<CardsAndCorners pronostic={basePronostic()} />);
  expect(screen.getByTestId("market-red-card")).toHaveTextContent(OPTION_PATTERN);
});

test("il n'y a plus de ligne Corners dans ce bloc (déplacée dans son propre bloc dédié)", () => {
  render(<CardsAndCorners pronostic={basePronostic()} />);
  expect(screen.queryByTestId("market-corners")).not.toBeInTheDocument();
});

test("pour chaque métrique, l'option sûre et l'option risquée sont deux lignes distinctes, jamais la même valeur répétée", () => {
  const pronostic = basePronostic();
  render(<CardsAndCorners pronostic={pronostic} />);
  for (const testId of ["market-yellow-cards", "market-red-card"]) {
    const { safe, risky } = pronostic.markets[testId === "market-yellow-cards" ? "yellowCards" : "redCards"];
    expect(`${safe.side}${safe.line}`).not.toBe(`${risky.side}${risky.line}`);
  }
});

test("les joueurs susceptibles de prendre un carton sont affichés par équipe, jamais mélangés", () => {
  const pronostic = basePronostic({
    cardProneness: {
      home: [{ name: "Declan Rice", yellow: 5, red: 0 }],
      away: [{ name: "Moises Caicedo", yellow: 6, red: 1 }],
    },
  });
  render(<CardsAndCorners pronostic={pronostic} />);

  const homeCol = screen.getByTestId("card-prone-home");
  const awayCol = screen.getByTestId("card-prone-away");
  expect(within(homeCol).getByText("Declan Rice")).toBeInTheDocument();
  expect(within(homeCol).getByText(/5 jaunes cette saison/)).toBeInTheDocument();
  expect(within(awayCol).getByText("Moises Caicedo")).toBeInTheDocument();
  expect(within(awayCol).getByText(/6 jaunes.*1 rouge cette saison/)).toBeInTheDocument();
  expect(within(homeCol).queryByText("Moises Caicedo")).not.toBeInTheDocument();
});

test("sans donnée de cartons par joueur (clé API-Football absente ou source indisponible) : \"Indisponible\", jamais un joueur inventé", () => {
  const pronostic = basePronostic({ cardProneness: { home: [], away: [] } });
  render(<CardsAndCorners pronostic={pronostic} />);
  expect(screen.getAllByText("Indisponible").length).toBe(2);
  expect(screen.getByText("Aucune donnée de cartons par joueur disponible pour ce match.")).toBeInTheDocument();
});

test("ne s'affiche pas quand le pronostic n'est pas disponible (pas de carte vide/cassée)", () => {
  const { container } = render(<CardsAndCorners pronostic={{ available: false }} />);
  expect(container).toBeEmptyDOMElement();
});

test("deux matchs différents affichent des lignes de cartons différentes — jamais recopiées d'un match à l'autre", () => {
  const { unmount } = render(<CardsAndCorners pronostic={basePronostic()} />);
  const match1 = screen.getByTestId("cards-corners-markets").textContent;
  unmount();

  const otherPronostic = computePronostic({
    homeRow: row({ id: 3, goalsFor: 15, goalsAgainst: 12 }),
    awayRow: row({ id: 4, goalsFor: 14, goalsAgainst: 13 }),
    homeTeamName: "Défense A", awayTeamName: "Défense B",
  });
  render(<CardsAndCorners pronostic={otherPronostic} />);
  const match2 = screen.getByTestId("cards-corners-markets").textContent;

  expect(match1).not.toBe(match2);
});
