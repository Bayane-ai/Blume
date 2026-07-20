/**
 * @jest-environment jsdom
 *
 * components/ProbableScorers.js — bloc "Buteurs probables" : deux colonnes séparées
 * (domicile/extérieur), format ligne de pari sportif ("X marque (ou son remplaçant)")
 * SANS jamais afficher de cote, et jamais de pourcentage (réservé au 1X2). Les
 * passeurs décisifs probables ont désormais leur propre bloc (voir
 * components/AssistsProbables.js et assists-probables.test.jsx).
 */
import { render, screen, within } from "@testing-library/react";
import ProbableScorers from "../components/ProbableScorers";

function pronosticFixture(overrides = {}) {
  return {
    available: true,
    home: { name: "Arsenal FC" },
    away: { name: "Chelsea FC" },
    probableScorers: {
      home: {
        scorers: [{ name: "Bukayo Saka", goals: 12 }, { name: "Kai Havertz", goals: 8 }],
        assists: [{ name: "Martin Ødegaard", assists: 9 }],
      },
      away: {
        scorers: [{ name: "Cole Palmer", goals: 15 }],
        assists: [{ name: "Enzo Fernández", assists: 6 }],
      },
    },
    ...overrides,
  };
}

test('chaque buteur probable est présenté comme une ligne de pari ("X marque (ou son remplaçant)"), avec le vrai total de buts, jamais une cote', () => {
  render(<ProbableScorers pronostic={pronosticFixture()} />);

  const homeCol = screen.getByTestId("scorers-home");
  expect(within(homeCol).getByText("Bukayo Saka marque (ou son remplaçant)")).toBeInTheDocument();
  expect(within(homeCol).getByText("12 buts cette saison")).toBeInTheDocument();

  // Aucune cote nulle part (format décimal type 1.85/2.40).
  const { container } = render(<ProbableScorers pronostic={pronosticFixture()} />);
  expect(container.textContent).not.toMatch(/\b\d\.\d{2}\b/);
  // Aucun pourcentage dans ce bloc (réservé à la carte "Probabilité de victoire").
  expect(container.textContent).not.toMatch(/%/);
});

test("les passeurs décisifs probables n'apparaissent plus dans ce bloc (déplacés vers leur propre carte)", () => {
  render(<ProbableScorers pronostic={pronosticFixture()} />);
  const homeCol = screen.getByTestId("scorers-home");
  expect(within(homeCol).queryByText(/passe décisive/)).not.toBeInTheDocument();
  expect(within(homeCol).queryByText(/Martin Ødegaard/)).not.toBeInTheDocument();
});

test("chaque équipe affiche SES propres joueurs — jamais mélangés entre les deux colonnes", () => {
  render(<ProbableScorers pronostic={pronosticFixture()} />);
  const homeCol = screen.getByTestId("scorers-home");
  const awayCol = screen.getByTestId("scorers-away");

  expect(within(homeCol).getByText("Arsenal FC")).toBeInTheDocument();
  expect(within(awayCol).getByText("Chelsea FC")).toBeInTheDocument();

  expect(within(homeCol).queryByText(/Cole Palmer/)).not.toBeInTheDocument();
  expect(within(awayCol).queryByText(/Bukayo Saka/)).not.toBeInTheDocument();
});

test("une équipe sans donnée de buteur affiche \"Indisponible\", jamais un joueur inventé ni une section vide", () => {
  const pronostic = pronosticFixture({
    probableScorers: {
      home: { scorers: [], assists: [] },
      away: { scorers: [{ name: "Cole Palmer", goals: 15 }], assists: [] },
    },
  });
  render(<ProbableScorers pronostic={pronostic} />);

  const homeCol = screen.getByTestId("scorers-home");
  expect(within(homeCol).getAllByText("Indisponible").length).toBe(1);
});

test("aucune donnée pour aucune des deux équipes : message honnête, jamais une section vide", () => {
  const pronostic = pronosticFixture({
    probableScorers: { home: { scorers: [], assists: [] }, away: { scorers: [], assists: [] } },
  });
  render(<ProbableScorers pronostic={pronostic} />);
  expect(screen.getByText("Aucune donnée de buteur disponible pour ce match.")).toBeInTheDocument();
});

test("ne s'affiche pas quand le pronostic n'est pas disponible (pas de carte vide/cassée)", () => {
  const { container } = render(<ProbableScorers pronostic={{ available: false }} />);
  expect(container).toBeEmptyDOMElement();
});

test("deux matchs différents affichent des buteurs probables différents — jamais recopiés d'un match à l'autre", () => {
  const { unmount } = render(<ProbableScorers pronostic={pronosticFixture()} />);
  const match1Home = screen.getByTestId("scorers-home").textContent;
  unmount();

  const otherFixture = pronosticFixture({
    home: { name: "Real Madrid" },
    away: { name: "Barcelona" },
    probableScorers: {
      home: { scorers: [{ name: "Vinícius Júnior", goals: 18 }], assists: [] },
      away: { scorers: [{ name: "Robert Lewandowski", goals: 22 }], assists: [] },
    },
  });
  render(<ProbableScorers pronostic={otherFixture} />);
  const match2Home = screen.getByTestId("scorers-home").textContent;

  expect(match1Home).not.toBe(match2Home);
});
