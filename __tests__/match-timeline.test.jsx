/**
 * @jest-environment jsdom
 *
 * Timeline des moments forts d'un match (buts, cartons, remplacements) : ordre
 * chronologique inversé (le plus récent en premier) avec séparateurs "Coup d'envoi"
 * et "Mi-temps", icône + minute + joueur par événement, score juste après chaque
 * but, équipe à domicile alignée à gauche / à l'extérieur à droite. Si l'API ne
 * fournit aucun événement (le cas réel aujourd'hui, football-data.org ne les fournit
 * pas), un message clair s'affiche — jamais une section vide ni une erreur.
 */
import { render, screen, within } from "@testing-library/react";
import MatchTimeline from "../components/MatchTimeline";

const HOME_ID = 10;
const AWAY_ID = 11;

function events() {
  return [
    { id: "e1", minute: 5, type: "GOAL", teamId: HOME_ID, player: { name: "Bukayo Saka" }, scoreAfter: { home: 1, away: 0 } },
    { id: "e2", minute: 30, type: "YELLOW_CARD", teamId: AWAY_ID, player: { name: "Reece James" } },
    { id: "e3", minute: 52, type: "SUBSTITUTION", teamId: HOME_ID, playerIn: { name: "Gabriel Jesus" }, playerOut: { name: "Eddie Nketiah" } },
    { id: "e4", minute: 78, type: "GOAL", teamId: AWAY_ID, player: { name: "Cole Palmer" }, scoreAfter: { home: 1, away: 1 } },
    { id: "e5", minute: 90, type: "RED_CARD", teamId: HOME_ID, player: { name: "Declan Rice" } },
  ];
}

test("si l'API ne fournit aucun événement, un message clair s'affiche — jamais une section vide", () => {
  render(<MatchTimeline events={null} homeTeamId={HOME_ID} />);
  expect(screen.getByText("Événements non disponibles pour ce match.")).toBeInTheDocument();
  expect(screen.queryByTestId("match-timeline")).not.toBeInTheDocument();
});

test("un tableau vide affiche aussi le message clair, pas une liste vide silencieuse", () => {
  render(<MatchTimeline events={[]} homeTeamId={HOME_ID} />);
  expect(screen.getByText("Événements non disponibles pour ce match.")).toBeInTheDocument();
});

test("affiche chaque événement (minute, icône, joueur), du plus récent au plus ancien, avec les séparateurs Coup d'envoi/Mi-temps", () => {
  render(<MatchTimeline events={events()} homeTeamId={HOME_ID} />);

  const timeline = screen.getByTestId("match-timeline");
  const children = Array.from(timeline.children);

  // Ordre attendu, du plus récent au plus ancien : carton rouge (90'), but (78'),
  // remplacement (52', premier événement de la 2e mi-temps rencontré), séparateur
  // Mi-temps, carton jaune (30'), but (5'), Coup d'envoi.
  const textOrder = children.map((c) => c.textContent);
  expect(textOrder[0]).toMatch(/90.*Declan Rice/);
  expect(textOrder[1]).toMatch(/78.*Cole Palmer/);
  expect(textOrder[2]).toMatch(/52.*Gabriel Jesus.*Eddie Nketiah/);
  expect(textOrder[3]).toBe("Mi-temps");
  expect(textOrder[4]).toMatch(/30.*Reece James/);
  expect(textOrder[5]).toMatch(/5.*Bukayo Saka/);
  expect(textOrder[6]).toBe("Coup d'envoi");
});

test("pour chaque but, le score juste après ce but est affiché à côté de la ligne", () => {
  render(<MatchTimeline events={events()} homeTeamId={HOME_ID} />);
  expect(screen.getByText("1 - 0")).toBeInTheDocument();
  expect(screen.getByText("1 - 1")).toBeInTheDocument();
});

test("les événements de l'équipe à domicile sont alignés à gauche, ceux de l'extérieur à droite", () => {
  render(<MatchTimeline events={events()} homeTeamId={HOME_ID} />);
  const rows = screen.getAllByTestId("timeline-event");

  // Bukayo Saka (domicile) : aligné à gauche.
  const homeRow = rows.find((r) => r.textContent.includes("Bukayo Saka"));
  expect(homeRow).toHaveStyle({ justifyContent: "flex-start" });

  // Cole Palmer (extérieur) : aligné à droite.
  const awayRow = rows.find((r) => r.textContent.includes("Cole Palmer"));
  expect(awayRow).toHaveStyle({ justifyContent: "flex-end" });
});

test("chaque type d'événement a sa propre icône (but, carton jaune, carton rouge, remplacement)", () => {
  render(<MatchTimeline events={events()} homeTeamId={HOME_ID} />);
  expect(screen.getAllByRole("img", { name: "But" }).length).toBe(2);
  expect(screen.getByRole("img", { name: "Carton jaune" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Carton rouge" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Remplacement" })).toBeInTheDocument();
});
