/**
 * @jest-environment jsdom
 *
 * components/AssistsProbables.js — bloc "Passes décisives probables", en bas de la
 * page de match : deux colonnes séparées (domicile/extérieur), format ligne de pari
 * sportif ("X passe décisive (ou son remplaçant)"), SANS jamais afficher de cote ni
 * de pourcentage. Même source réelle que "Buteurs probables"
 * (pronostic.probableScorers), simplement dans son propre bloc.
 */
import { render, screen, within } from "@testing-library/react";
import AssistsProbables from "../components/AssistsProbables";

function pronosticFixture(overrides = {}) {
  return {
    available: true,
    home: { name: "Arsenal FC" },
    away: { name: "Chelsea FC" },
    probableScorers: {
      home: {
        scorers: [{ name: "Bukayo Saka", goals: 12 }],
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

test('chaque passeur décisif probable est présenté comme une ligne de pari ("X passe décisive (ou son remplaçant)"), avec le vrai total de passes, jamais une cote', () => {
  render(<AssistsProbables pronostic={pronosticFixture()} />);

  const homeCol = screen.getByTestId("assists-home");
  expect(within(homeCol).getByText("Martin Ødegaard passe décisive (ou son remplaçant)")).toBeInTheDocument();
  expect(within(homeCol).getByText("9 passes décisives cette saison")).toBeInTheDocument();

  const { container } = render(<AssistsProbables pronostic={pronosticFixture()} />);
  expect(container.textContent).not.toMatch(/\b\d\.\d{2}\b/);
  expect(container.textContent).not.toMatch(/%/);
});

test("aucun buteur n'apparaît dans ce bloc (réservé aux passeurs décisifs)", () => {
  render(<AssistsProbables pronostic={pronosticFixture()} />);
  const homeCol = screen.getByTestId("assists-home");
  expect(within(homeCol).queryByText(/marque/)).not.toBeInTheDocument();
  expect(within(homeCol).queryByText(/Bukayo Saka/)).not.toBeInTheDocument();
});

test("chaque équipe affiche SES propres passeurs — jamais mélangés entre les deux colonnes", () => {
  render(<AssistsProbables pronostic={pronosticFixture()} />);
  const homeCol = screen.getByTestId("assists-home");
  const awayCol = screen.getByTestId("assists-away");

  expect(within(homeCol).getByText("Arsenal FC")).toBeInTheDocument();
  expect(within(awayCol).getByText("Chelsea FC")).toBeInTheDocument();
  expect(within(homeCol).queryByText(/Enzo Fernández/)).not.toBeInTheDocument();
  expect(within(awayCol).queryByText(/Martin Ødegaard/)).not.toBeInTheDocument();
});

test("une équipe sans donnée de passe décisive affiche \"Indisponible\", jamais un joueur inventé", () => {
  const pronostic = pronosticFixture({
    probableScorers: {
      home: { scorers: [], assists: [] },
      away: { scorers: [], assists: [{ name: "Enzo Fernández", assists: 6 }] },
    },
  });
  render(<AssistsProbables pronostic={pronostic} />);
  const homeCol = screen.getByTestId("assists-home");
  expect(within(homeCol).getByText("Indisponible")).toBeInTheDocument();
});

test("aucune donnée pour aucune des deux équipes : message honnête, jamais une section vide", () => {
  const pronostic = pronosticFixture({
    probableScorers: { home: { scorers: [], assists: [] }, away: { scorers: [], assists: [] } },
  });
  render(<AssistsProbables pronostic={pronostic} />);
  expect(screen.getByText("Aucune donnée de passe décisive disponible pour ce match.")).toBeInTheDocument();
});

test("ne s'affiche pas quand le pronostic n'est pas disponible (pas de carte vide/cassée)", () => {
  const { container } = render(<AssistsProbables pronostic={{ available: false }} />);
  expect(container).toBeEmptyDOMElement();
});

test("deux matchs différents affichent des passes décisives différentes — jamais recopiées d'un match à l'autre", () => {
  const { unmount } = render(<AssistsProbables pronostic={pronosticFixture()} />);
  const match1Home = screen.getByTestId("assists-home").textContent;
  unmount();

  const otherFixture = pronosticFixture({
    home: { name: "Real Madrid" },
    away: { name: "Barcelona" },
    probableScorers: {
      home: { scorers: [], assists: [{ name: "Jude Bellingham", assists: 11 }] },
      away: { scorers: [], assists: [{ name: "Pedri", assists: 7 }] },
    },
  });
  render(<AssistsProbables pronostic={otherFixture} />);
  const match2Home = screen.getByTestId("assists-home").textContent;

  expect(match1Home).not.toBe(match2Home);
});
