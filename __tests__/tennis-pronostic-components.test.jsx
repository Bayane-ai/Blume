/**
 * @jest-environment jsdom
 *
 * components/TennisPronosticResults.js / TennisSecondaryStats.js /
 * TennisServiceReturnContext.js / TennisMatchScenario.js — les 11 blocs demandés,
 * même style de carte que football/basket, pourcentages réservés à la probabilité de
 * victoire, jamais de cote affichée.
 */
import { render, screen } from "@testing-library/react";
import TennisPronosticResults from "../components/TennisPronosticResults";
import TennisSecondaryStats from "../components/TennisSecondaryStats";
import TennisServiceReturnContext from "../components/TennisServiceReturnContext";
import TennisMatchScenario from "../components/TennisMatchScenario";

function line(l, side) {
  return { available: true, lines: [{ line: l, side, confidence: 55 }] };
}

function fullPronostic(overrides = {}) {
  return {
    available: true,
    home: { name: "Novak Djokovic", ranking: 1, form: "WWWWL" },
    away: { name: "Carlos Alcaraz", ranking: 2, form: "WWLWW" },
    probabilities: { home: 58.3, away: 41.7 },
    setScores: [
      { score: "2-0", winner: "p1", probability: 34.2 },
      { score: "2-1", winner: "p1", probability: 21.5 },
      { score: "1-2", winner: "p2", probability: 18.9 },
      { score: "0-2", winner: "p2", probability: 25.4 },
    ],
    gameTotals: { total: line(22.5, "Plus"), home: line(12.5, "Plus"), away: line(10.5, "Moins") },
    gameHandicap: { favorite: "home", safe: { line: 1.5, side: "Plus" }, risky: { line: 3.5, side: "Plus" } },
    setsBlock: {
      totalSets: { line: 2.5, side: "Moins" },
      bothWinASet: "Oui",
      firstSetWinner: "home",
      firstSetGames: line(9.5, "Moins"),
    },
    aces: { total: line(13.5, "Plus"), home: line(8.5, "Plus"), away: line(4.5, "Moins") },
    doubleFaults: { total: line(5.5, "Moins"), home: line(2.5, "Moins"), away: line(3.5, "Plus") },
    breaks: { total: line(3.5, "Plus"), home: line(1.5, "Plus"), away: line(1.5, "Moins") },
    tiebreak: { likely: "Non" },
    serviceReturnContext: {
      home: { firstServeInPct: 64, firstServeWonPct: 76, secondServeWonPct: 52, breakPointsConvertedPct: 44 },
      away: { firstServeInPct: 58, firstServeWonPct: 71, secondServeWonPct: 48, breakPointsConvertedPct: 39 },
    },
    narrative: {
      winProbability: "Novak Djokovic part favori (58.3 %), classé 1er mondial.",
      matchScenario: "Sur dur, Djokovic devrait tenir son service plus facilement qu'Alcaraz. Peu de breaks sont attendus.",
    },
    note: "Estimation statistique (modèle de Markov jeu → set → match).",
    ...overrides,
  };
}

describe("TennisPronosticResults — Blocs 1-5", () => {
  test("Bloc 1 : probabilité de victoire des deux joueurs, avec justification", () => {
    render(<TennisPronosticResults pronostic={fullPronostic()} />);
    expect(screen.getByTestId("tennis-prob-home")).toHaveTextContent("Novak Djokovic");
    expect(screen.getByTestId("tennis-prob-home")).toHaveTextContent("58.3 %");
    expect(screen.getByTestId("tennis-prob-away")).toHaveTextContent("41.7 %");
    expect(screen.getByText(/classé 1er mondial/)).toBeInTheDocument();
  });

  test("Bloc 2 : entre 3 et 4 scores en sets probables", () => {
    render(<TennisPronosticResults pronostic={fullPronostic()} />);
    const scores = screen.getByTestId("tennis-set-scores");
    expect(scores).toHaveTextContent("2 - 0");
    expect(scores).toHaveTextContent("2 - 1");
    expect(scores).toHaveTextContent("0 - 2");
  });

  test("Bloc 3 : totaux de jeux au format Plus/Moins de X,5", () => {
    render(<TennisPronosticResults pronostic={fullPronostic()} />);
    expect(screen.getByTestId("tennis-market-total")).toHaveTextContent("Plus de 22,5");
    expect(screen.getByTestId("tennis-market-total-1")).toHaveTextContent("Plus de 12,5");
    expect(screen.getByTestId("tennis-market-total-2")).toHaveTextContent("Moins de 10,5");
  });

  test("Bloc 4 : handicap jeux avec une option sûre et une option risquée", () => {
    render(<TennisPronosticResults pronostic={fullPronostic()} />);
    const handicap = screen.getByTestId("tennis-handicap");
    expect(handicap).toHaveTextContent("Novak Djokovic");
    expect(handicap).toHaveTextContent("Sûr");
    expect(handicap).toHaveTextContent("Risqué");
  });

  test("Bloc 5 : total de sets, les deux gagnent un set, 1er set + total de jeux", () => {
    render(<TennisPronosticResults pronostic={fullPronostic()} />);
    expect(screen.getByTestId("tennis-total-sets")).toHaveTextContent("Moins de 2,5");
    expect(screen.getByTestId("tennis-both-win-a-set")).toHaveTextContent("Oui");
    expect(screen.getByTestId("tennis-first-set-winner")).toHaveTextContent("Novak Djokovic");
    expect(screen.getByTestId("tennis-first-set-games")).toHaveTextContent("Moins de 9,5");
  });

  test("aucune cote affichée nulle part sur la page (jamais de nombre style '1.85')", () => {
    render(<TennisPronosticResults pronostic={fullPronostic()} />);
    expect(screen.queryByText(/\b\d\.\d{2}\b/)).not.toBeInTheDocument();
  });

  test("message honnête quand le pronostic est indisponible, jamais une carte vide", () => {
    render(<TennisPronosticResults pronostic={{ available: false, reason: "profil de joueur indisponible" }} />);
    expect(screen.getByText("profil de joueur indisponible")).toBeInTheDocument();
  });
});

describe("TennisSecondaryStats — Blocs 6-9", () => {
  test("Aces, doubles fautes, breaks : Total match + Total 1 + Total 2 chacun", () => {
    render(<TennisSecondaryStats pronostic={fullPronostic()} />);
    expect(screen.getByTestId("tennis-stat-aces-total")).toHaveTextContent("Plus de 13,5");
    expect(screen.getByTestId("tennis-stat-aces-home")).toHaveTextContent("Novak Djokovic");
    expect(screen.getByTestId("tennis-stat-double-faults-total")).toHaveTextContent("Moins de 5,5");
    expect(screen.getByTestId("tennis-stat-breaks-total")).toHaveTextContent("Plus de 3,5");
  });

  test("jeu décisif : Oui/Non uniquement, jamais un pourcentage", () => {
    render(<TennisSecondaryStats pronostic={fullPronostic()} />);
    expect(screen.getByTestId("tennis-stat-tiebreak-value")).toHaveTextContent("Non");
    expect(screen.getByTestId("tennis-stat-tiebreak-value")).not.toHaveTextContent("%");
  });

  test("rien ne s'affiche si le pronostic est indisponible", () => {
    const { container } = render(<TennisSecondaryStats pronostic={{ available: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TennisServiceReturnContext — Bloc 10", () => {
  test("les vrais chiffres de chaque joueur, jamais mélangés, présentés comme éléments d'analyse", () => {
    render(<TennisServiceReturnContext pronostic={fullPronostic()} />);
    expect(screen.getByTestId("tennis-context-home")).toHaveTextContent("64 %");
    expect(screen.getByTestId("tennis-context-home")).toHaveTextContent("76 %");
    expect(screen.getByTestId("tennis-context-away")).toHaveTextContent("58 %");
  });

  test("une statistique indisponible s'affiche honnêtement, jamais une valeur inventée", () => {
    const pronostic = fullPronostic({
      serviceReturnContext: { home: { firstServeInPct: null, firstServeWonPct: null, secondServeWonPct: null, breakPointsConvertedPct: null }, away: {} },
    });
    render(<TennisServiceReturnContext pronostic={pronostic} />);
    expect(screen.getByTestId("tennis-context-home")).toHaveTextContent("Indisponible");
  });
});

describe("TennisMatchScenario — Bloc 11", () => {
  test("affiche le scénario généré à partir des vrais chiffres du match", () => {
    render(<TennisMatchScenario pronostic={fullPronostic()} />);
    expect(screen.getByTestId("tennis-match-scenario-text")).toHaveTextContent(/Djokovic/);
  });

  test("rien ne s'affiche si le pronostic est indisponible", () => {
    const { container } = render(<TennisMatchScenario pronostic={{ available: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
