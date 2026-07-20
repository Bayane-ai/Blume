/**
 * @jest-environment jsdom
 *
 * Bloc statistiques — refonte "app de paris sportifs" : structure EXACTE demandée,
 * dans cet ordre, sans jamais afficher de cote (pas de 1.85, 2.40...) :
 * 1) Probabilité de victoire (1X2) — 3 lignes en "%", qui somment à 100. C'est la
 *    SEULE section du bloc où un "%" apparaît (les autres blocs — Corners et
 *    cartons — ont leur propre carte séparée, voir cards-and-corners.test.jsx).
 * 2) Total (buts du match entier) — "Total : Plus de X,X" / "Moins de X,X", avec
 *    une marge (deux lignes) possible quand l'issue est incertaine.
 * 3) Total 1 (domicile seul).
 * 4) Total 2 (extérieur seul) — jamais mélangé avec le domicile.
 * 5) Tirs.
 * 6) Scores exacts (3 à 4, différents par match). Corners/cartons/passes décisives
 *    ont désormais leur propre bloc, en bas de la page de match (voir
 *    components/CardsAndCorners.js et components/AssistsProbables.js).
 */
import { render, screen, within } from "@testing-library/react";
import PronosticResults from "../components/PronosticResults";
import { computePronostic } from "../lib/pronostic";
import { marketLabel } from "../lib/marketFormat";

function rowFor({ goalsFor, goalsAgainst, playedGames = 20, id, position = 5, points = 30 }) {
  return { position, points, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

test("structure exacte du bloc, dans l'ordre demandé, sans aucune cote affichée", () => {
  const pronostic = computePronostic({
    homeRow: rowFor({ goalsFor: 45, goalsAgainst: 20, id: 1 }),
    awayRow: rowFor({ goalsFor: 30, goalsAgainst: 28, id: 2 }),
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
  });

  const { container } = render(<PronosticResults pronostic={pronostic} loading={false} />);

  // 1) 1X2 : trois lignes au format exact demandé, qui somment à 100.
  expect(screen.getByTestId("prob-home")).toHaveTextContent(/^Victoire Arsenal FC : \d+(\.\d+)? %$/);
  expect(screen.getByTestId("prob-draw")).toHaveTextContent(/^Match nul : \d+(\.\d+)? %$/);
  expect(screen.getByTestId("prob-away")).toHaveTextContent(/^Victoire Chelsea FC : \d+(\.\d+)? %$/);
  const sum = pronostic.probabilities.home + pronostic.probabilities.draw + pronostic.probabilities.away;
  expect(Math.round(sum * 10) / 10).toBe(100);

  // 2-5) Lignes de marché au format exact demandé ("Total : Plus de X,X"), avec une
  // virgule française et jamais un nombre entier (toujours X,5) — une marge
  // optionnelle ("(ou X,5)") est acceptée pour les totaux de buts uniquement.
  const lineFormat = /^(Total|Total 1|Total 2|Tirs) : (Plus|Moins) de \d+,5( \(ou \d+,5\))?$/;
  expect(screen.getByTestId("market-total")).toHaveTextContent(lineFormat);
  expect(screen.getByTestId("market-total-1")).toHaveTextContent(lineFormat);
  expect(screen.getByTestId("market-total-2")).toHaveTextContent(lineFormat);
  expect(screen.getByTestId("market-shots")).toHaveTextContent(lineFormat);

  // Corners et cartons ne sont plus dans ce bloc (voir components/CardsAndCorners.js).
  expect(screen.queryByTestId("market-corners")).not.toBeInTheDocument();
  expect(screen.queryByTestId("market-cards")).not.toBeInTheDocument();

  // Ordre exact dans le document : 1X2 (3 lignes) puis Total, Total 1, Total 2,
  // Tirs, puis Scores exacts — jamais un autre ordre.
  const orderedTestIds = [
    "prob-home", "prob-draw", "prob-away",
    "market-total", "market-total-1", "market-total-2", "market-shots",
  ];
  const nodes = orderedTestIds.map((id) => screen.getByTestId(id));
  for (let i = 1; i < nodes.length; i++) {
    expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  const correctScoresBlock = screen.getByTestId("correct-scores");
  expect(nodes[nodes.length - 1].compareDocumentPosition(correctScoresBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // Entre 3 et 4 scores exacts, sans aucun pourcentage ni cote affichée à côté.
  const scoreLabels = within(correctScoresBlock).getAllByText(/^Le plus probable$|^Possible$/);
  expect(scoreLabels.length).toBeGreaterThanOrEqual(3);
  expect(scoreLabels.length).toBeLessThanOrEqual(4);
  expect(correctScoresBlock.textContent).not.toMatch(/%/);

  // Aucune cote nulle part (format décimal typique d'une cote, ex: 1.85, 2.40) et
  // aucun "%" en dehors des 3 valeurs de victoire 1X2.
  expect(container.textContent).not.toMatch(/\b\d\.\d{2}\b/);
  const percentCount = (container.textContent.match(/%/g) || []).length;
  expect(percentCount).toBe(3);
});

test("Total 1 et Total 2 ne sont jamais mélangés : chaque équipe a sa propre ligne, dérivée de ses propres buts attendus", () => {
  // Profils délibérément opposés : domicile très offensif, extérieur très défensif.
  const pronostic = computePronostic({
    homeRow: rowFor({ goalsFor: 65, goalsAgainst: 15, id: 1 }),
    awayRow: rowFor({ goalsFor: 15, goalsAgainst: 55, id: 2 }),
    homeTeamName: "Attaque FC", awayTeamName: "Defense FC",
  });

  render(<PronosticResults pronostic={pronostic} loading={false} />);

  expect(pronostic.markets.totalHome.line).not.toBe(pronostic.markets.totalAway.line);
  const totalHomeText = screen.getByTestId("market-total-1").textContent;
  const totalAwayText = screen.getByTestId("market-total-2").textContent;
  expect(totalHomeText).toBe(`Total 1 : ${marketLabel(pronostic.markets.totalHome)}`);
  expect(totalAwayText).not.toBe(totalHomeText.replace("Total 1", "Total 2"));
});

test('"Probabilité de victoire" est une carte à part, avec son propre titre, séparée du bloc des statistiques — pas une ligne mélangée dedans', () => {
  const pronostic = computePronostic({
    homeRow: rowFor({ goalsFor: 45, goalsAgainst: 20, id: 1 }),
    awayRow: rowFor({ goalsFor: 30, goalsAgainst: 28, id: 2 }),
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
  });

  render(<PronosticResults pronostic={pronostic} loading={false} />);

  const winCard = screen.getByTestId("win-probability-card");
  const statsCard = screen.getByTestId("match-stats-card");

  // Deux <section> bien distinctes, pas un seul bloc commun.
  expect(winCard).not.toBe(statsCard);
  expect(winCard.tagName).toBe("SECTION");
  expect(statsCard.tagName).toBe("SECTION");

  // Titre propre, visible, avant le contenu.
  expect(within(winCard).getByRole("heading", { name: "Probabilité de victoire" })).toBeInTheDocument();

  // La carte "Probabilité de victoire" apparaît en premier dans le document.
  expect(winCard.compareDocumentPosition(statsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // Le 1X2 est bien DANS sa propre carte, et rien des statistiques (Total,
  // scores exacts) n'y apparaît.
  expect(within(winCard).getByTestId("prob-home")).toBeInTheDocument();
  expect(within(winCard).getByTestId("prob-draw")).toBeInTheDocument();
  expect(within(winCard).getByTestId("prob-away")).toBeInTheDocument();
  expect(within(winCard).queryByTestId("market-total")).not.toBeInTheDocument();
  expect(within(winCard).queryByTestId("correct-scores")).not.toBeInTheDocument();

  // Et inversement, aucune probabilité de victoire dans la carte des statistiques.
  expect(within(statsCard).queryByTestId("prob-home")).not.toBeInTheDocument();
  expect(within(statsCard).getByTestId("market-total")).toBeInTheDocument();
  expect(within(statsCard).getByTestId("correct-scores")).toBeInTheDocument();

  // Les deux cartes sont visuellement séparées (fond + bordure propres), pas un
  // simple <div> transparent au milieu d'un autre bloc.
  expect(winCard).toHaveStyle({ background: "#FFFFFF", border: "1px solid #D8E6DE" });
  expect(statsCard).toHaveStyle({ background: "#FFFFFF", border: "1px solid #D8E6DE" });
});

test("chaque match a ses propres valeurs dans la carte \"Probabilité de victoire\" — jamais les mêmes pourcentages recopiés d'un match à l'autre", () => {
  const matchA = computePronostic({
    homeRow: rowFor({ goalsFor: 55, goalsAgainst: 15, id: 1, position: 2, points: 60 }),
    awayRow: rowFor({ goalsFor: 18, goalsAgainst: 50, id: 2, position: 18, points: 20 }),
    homeTeamName: "Arsenal FC", awayTeamName: "Fulham FC",
  });
  const matchB = computePronostic({
    homeRow: rowFor({ goalsFor: 62, goalsAgainst: 18, id: 3, position: 1, points: 68 }),
    awayRow: rowFor({ goalsFor: 58, goalsAgainst: 20, id: 4, position: 2, points: 64 }),
    homeTeamName: "Real Madrid", awayTeamName: "Barcelona",
  });

  const { unmount } = render(<PronosticResults pronostic={matchA} loading={false} />);
  const a = {
    home: screen.getByTestId("prob-home").textContent,
    draw: screen.getByTestId("prob-draw").textContent,
    away: screen.getByTestId("prob-away").textContent,
  };
  unmount();

  render(<PronosticResults pronostic={matchB} loading={false} />);
  const b = {
    home: screen.getByTestId("prob-home").textContent,
    draw: screen.getByTestId("prob-draw").textContent,
    away: screen.getByTestId("prob-away").textContent,
  };

  expect(a.home).not.toBe(b.home);
  expect(a.draw).not.toBe(b.draw);
  expect(a.away).not.toBe(b.away);
});

test("l'ordre des scores exacts va du plus probable au moins probable, sans aucun pourcentage affiché", () => {
  const pronostic = computePronostic({
    homeRow: rowFor({ goalsFor: 60, goalsAgainst: 15, id: 1 }),
    awayRow: rowFor({ goalsFor: 20, goalsAgainst: 45, id: 2 }),
    homeTeamName: "Real Madrid", awayTeamName: "Getafe CF",
  });

  render(<PronosticResults pronostic={pronostic} loading={false} />);
  const scoresBlock = screen.getByTestId("correct-scores");
  const labels = within(scoresBlock).getAllByText(/^Le plus probable$|^Possible$/).map((el) => el.textContent);

  expect(labels[0]).toBe("Le plus probable");
  expect(labels.slice(1).every((l) => l === "Possible")).toBe(true);
  expect(pronostic.correctScores.length).toBeGreaterThanOrEqual(3);
  expect(pronostic.correctScores.length).toBeLessThanOrEqual(4);
});
