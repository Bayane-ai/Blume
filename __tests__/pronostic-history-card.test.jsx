/**
 * @jest-environment jsdom
 *
 * components/PronosticHistoryCard.js — une carte par match terminé et vérifié :
 * équipes, score final, date, pronostics donnés (1X2), badge global visible Succès
 * (vert) / Échec (rouge), ET (voir PROMPT "chaque ligne de pronostic doit porter un
 * indicateur visuel") CHAQUE ligne de pronostic comparée individuellement au vrai
 * résultat, avec son propre crochet vert (atteinte) / croix rouge (ratée) / mention
 * "Indisponible" quand aucune donnée réelle ne permet de trancher.
 */
import { render, screen } from "@testing-library/react";
import PronosticHistoryCard from "../components/PronosticHistoryCard";

function statBlock(total, home, away) {
  return {
    total: { line: total, side: "Plus", lines: [{ line: total, side: "Plus" }] },
    home: { line: home, side: "Plus", lines: [{ line: home, side: "Plus" }] },
    away: { line: away, side: "Plus", lines: [{ line: away, side: "Plus" }] },
    half: { label: "1ère mi-temps", market: { line: total / 2, side: "Plus", lines: [{ line: total / 2, side: "Plus" }] } },
  };
}

function baseItem(overrides = {}) {
  return {
    match_id: "101",
    home_team_name: "Arsenal FC",
    away_team_name: "Chelsea FC",
    match_date: "2026-01-15T15:00:00Z",
    final_score: { home: 2, away: 1 },
    status: "success",
    prediction: {
      probabilities: { home: 60, draw: 25, away: 15 },
      markets: {
        totalGoals: { line: 2.5, side: "Plus", lines: [{ line: 2.5, side: "Plus" }] },
        totalHome: { line: 1.5, side: "Plus", lines: [{ line: 1.5, side: "Plus" }] },
        totalAway: { line: 0.5, side: "Moins", lines: [{ line: 0.5, side: "Moins" }] },
        shots: { line: 23.5, side: "Plus", lines: [{ line: 23.5, side: "Plus" }] },
        yellowCards: { safe: { line: 3.5, side: "Moins" }, risky: { line: 2.5, side: "Moins" } },
        redCards: { safe: { line: 0.5, side: "Moins" }, risky: { line: 0.5, side: "Plus" } },
      },
      matchStats: {
        corners: statBlock(9.5, 5.5, 3.5),
        offsides: statBlock(3.5, 2.5, 1.5),
        fouls: statBlock(21.5, 11.5, 9.5),
        throwIns: statBlock(41.5, 21.5, 19.5),
      },
      verification: {
        totalGoals: true,
        totalHome: false,
        totalAway: true,
        corners: { total: true, home: false, away: true },
        offsides: { total: null, home: null, away: null },
        fouls: { total: false, home: false, away: true },
        throwIns: { total: null, home: null, away: null },
        shots: true,
        yellowCards: { safe: true, risky: false },
        redCards: { safe: null, risky: null },
      },
    },
    ...overrides,
  };
}

test("affiche les deux équipes, le score final et la date", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  expect(screen.getByText("Arsenal FC — Chelsea FC")).toBeInTheDocument();
  expect(screen.getByTestId("history-final-score")).toHaveTextContent("2 - 1");
  expect(screen.getByText("15/01/2026")).toBeInTheDocument();
});

test("affiche un badge \"Succès\" pour un match classé succès", () => {
  render(<PronosticHistoryCard item={baseItem({ status: "success" })} />);
  expect(screen.getByTestId("history-badge")).toHaveTextContent("Succès");
});

test("affiche un badge \"Échec\" pour un match classé échec", () => {
  render(<PronosticHistoryCard item={baseItem({ status: "failure" })} />);
  expect(screen.getByTestId("history-badge")).toHaveTextContent("Échec");
});

test("affiche les probabilités 1X2 données avant le match", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  expect(screen.getByText(/Victoire Arsenal FC : 60 %/)).toBeInTheDocument();
});

test("une ligne validée par le résultat réel affiche un crochet vert", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  const row = screen.getByText(/Total : Plus de 2,5/).closest('[data-testid="verified-line"]');
  expect(row.querySelector('[data-testid="line-icon-success"]')).toHaveTextContent("✓");
  expect(row.querySelector('[data-testid="line-icon-failure"]')).not.toBeInTheDocument();
});

test("une ligne ratée affiche une croix rouge", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  const row = screen.getByText(/Total 1 : Plus de 1,5/).closest('[data-testid="verified-line"]');
  expect(row.querySelector('[data-testid="line-icon-failure"]')).toHaveTextContent("✗");
  expect(row.querySelector('[data-testid="line-icon-success"]')).not.toBeInTheDocument();
});

test("une ligne sans donnée réelle disponible affiche \"Indisponible\", jamais un crochet/une croix inventés", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  // Hors-jeu (offsides) : verification à null dans le fixture (source indisponible).
  const row = screen.getByText(/^Total match : Plus de 3,5$/).closest('[data-testid="verified-line"]');
  expect(row).toHaveTextContent("Indisponible");
  expect(row.querySelector('[data-testid="line-icon-success"]')).not.toBeInTheDocument();
  expect(row.querySelector('[data-testid="line-icon-failure"]')).not.toBeInTheDocument();
});

test("les touches (rentrées en jeu) restent toujours \"Indisponible\" : aucune source réelle ne les fournit", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  const group = screen.getByTestId("verified-group-Touches");
  const rows = group.querySelectorAll('[data-testid="verified-line"]');
  expect(rows.length).toBeGreaterThan(0);
  rows.forEach((row) => {
    expect(row).toHaveTextContent("Indisponible");
  });
});

test("la ligne mi-temps de chaque bloc reste toujours \"Indisponible\" (aucun décompte réel par mi-temps)", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  const row = screen.getByText(/1ère mi-temps : Plus de 4,75/).closest('[data-testid="verified-line"]');
  expect(row).toHaveTextContent("Indisponible");
});

test("les cartons jaunes/rouges (sûr/risqué) sont vérifiés individuellement", () => {
  render(<PronosticHistoryCard item={baseItem()} />);
  const safeYellow = screen.getByText(/Cartons jaunes \(sûr\)/).closest('[data-testid="verified-line"]');
  const riskyYellow = screen.getByText(/Cartons jaunes \(risqué\)/).closest('[data-testid="verified-line"]');
  expect(safeYellow.querySelector('[data-testid="line-icon-success"]')).toBeInTheDocument();
  expect(riskyYellow.querySelector('[data-testid="line-icon-failure"]')).toBeInTheDocument();
});

test("sans données de vérification (ancienne entrée, avant l'ajout de cette fonctionnalité) : pas de section vérifiée, sans planter", () => {
  const item = baseItem();
  delete item.prediction.verification;
  const { container } = render(<PronosticHistoryCard item={item} />);
  expect(screen.queryByTestId("verified-lines")).not.toBeInTheDocument();
  expect(screen.getByText("Arsenal FC — Chelsea FC")).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/\b\d\.\d{2}\b/);
});

test("aucune cote affichée (jamais un nombre décimal type 1.85)", () => {
  const { container } = render(<PronosticHistoryCard item={baseItem()} />);
  expect(container.textContent).not.toMatch(/\b\d\.\d{2}\b/);
});

test("score indisponible affiché honnêtement plutôt qu'un score inventé", () => {
  render(<PronosticHistoryCard item={baseItem({ final_score: null })} />);
  expect(screen.getByTestId("history-final-score")).toHaveTextContent("Score indisponible");
});

test("ne s'affiche pas (pas de carte vide/cassée) sans item", () => {
  const { container } = render(<PronosticHistoryCard item={null} />);
  expect(container).toBeEmptyDOMElement();
});
