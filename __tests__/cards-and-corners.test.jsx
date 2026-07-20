/**
 * @jest-environment jsdom
 *
 * components/CardsAndCorners.js — bloc "Corners et cartons", en bas de la page de
 * pronostics : corners et cartons jaunes en ligne "Plus/Moins de X,5", cartons rouges
 * en probabilité (rares, événement binaire), et les vrais joueurs les plus sujets aux
 * cartons cette saison (best-effort, API-Football) — jamais un joueur inventé.
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

test("affiche corners et cartons jaunes en ligne Plus/Moins de X,5, jamais une cote", () => {
  render(<CardsAndCorners pronostic={basePronostic()} />);
  expect(screen.getByTestId("market-corners")).toHaveTextContent(/^Corners : (Plus|Moins) de \d+,5$/);
  expect(screen.getByTestId("market-yellow-cards")).toHaveTextContent(/^Cartons jaunes : (Plus|Moins) de \d+,5$/);
});

test("le carton rouge est exprimé en probabilité (%), pas en ligne Plus/Moins", () => {
  render(<CardsAndCorners pronostic={basePronostic()} />);
  expect(screen.getByTestId("market-red-card")).toHaveTextContent(/^Cartons rouges : \d+(\.\d+)? % de risque$/);
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

test("deux matchs différents affichent des lignes de corners/cartons différentes — jamais recopiées d'un match à l'autre", () => {
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
