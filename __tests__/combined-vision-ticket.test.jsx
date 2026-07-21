/**
 * @jest-environment jsdom
 *
 * components/CombinedVisionTicket.js — UN combiné (ticket) : ses sélections détaillées
 * match par match, un niveau de confiance, et la mention "En live" quand pertinent —
 * jamais de cote chiffrée affichée (voir PROMPT "Combiné Vision").
 */
import { render, screen, fireEvent } from "@testing-library/react";
import CombinedVisionTicket from "../components/CombinedVisionTicket";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
});

function leg(overrides = {}) {
  return {
    matchId: 1,
    homeTeamName: "Arsenal FC",
    awayTeamName: "Chelsea FC",
    competitionName: "Premier League",
    isLive: false,
    match: { id: 1, competition: { code: "PL" }, homeTeam: { id: 10, name: "Arsenal FC" }, awayTeam: { id: 11, name: "Chelsea FC" } },
    comp: { code: "PL", name: "Premier League" },
    marketLabel: "Issue du match",
    pickLabel: "Victoire Arsenal FC",
    confidence: 62,
    ...overrides,
  };
}

function combo(overrides = {}) {
  return {
    id: "combo-faible-1-2-prematch",
    riskLevel: "faible",
    confidence: 34.1,
    confidenceLabel: "Élevée",
    isLive: false,
    legs: [leg(), leg({ matchId: 2, homeTeamName: "Real Madrid", awayTeamName: "FC Barcelona", matchId: 2, match: { id: 2, competition: { code: "PD" } }, comp: { code: "PD" } })],
    ...overrides,
  };
}

test("affiche le niveau de risque et le niveau de confiance (jamais une cote chiffrée)", () => {
  render(<CombinedVisionTicket combo={combo()} />);
  expect(screen.getByTestId("ticket-risk-badge")).toHaveTextContent("Peu risqué");
  expect(screen.getByTestId("ticket-confidence")).toHaveTextContent(/Élevée/);
  expect(screen.getByTestId("ticket-confidence")).toHaveTextContent(/34/);
  expect(screen.getByTestId("ticket-confidence").textContent).not.toMatch(/\b\d\.\d{2}\b/); // jamais 1.85, 2.40...
});

test("affiche chaque sélection, match par match, avec l'équipe/la compétition/le pronostic choisi", () => {
  render(<CombinedVisionTicket combo={combo()} />);
  const legs = screen.getAllByTestId("ticket-leg");
  expect(legs).toHaveLength(2);
  expect(legs[0]).toHaveTextContent("Arsenal FC");
  expect(legs[0]).toHaveTextContent("Chelsea FC");
  expect(legs[0]).toHaveTextContent("Premier League");
  expect(legs[0]).toHaveTextContent("Issue du match");
  expect(legs[0]).toHaveTextContent("Victoire Arsenal FC");
});

test("cliquer sur une sélection mène directement à la page du vrai match concerné", () => {
  render(<CombinedVisionTicket combo={combo()} />);
  fireEvent.click(screen.getAllByTestId("ticket-leg")[0]);
  expect(pushMock).toHaveBeenCalledTimes(1);
  expect(pushMock.mock.calls[0][0].pathname).toBe("/match/1");
});

test("un combiné marqué \"en direct\" affiche la mention \"En live — saisir l'occasion\"", () => {
  render(<CombinedVisionTicket combo={combo({ isLive: true })} />);
  expect(screen.getByTestId("ticket-live-badge")).toHaveTextContent("En live — saisir l'occasion");
});

test("un combiné qui n'est pas en direct n'affiche aucune mention live", () => {
  render(<CombinedVisionTicket combo={combo({ isLive: false })} />);
  expect(screen.queryByTestId("ticket-live-badge")).not.toBeInTheDocument();
});

test("le niveau de risque \"très risqué\" est étiqueté clairement", () => {
  render(<CombinedVisionTicket combo={combo({ riskLevel: "eleve" })} />);
  expect(screen.getByTestId("ticket-risk-badge")).toHaveTextContent("Très risqué");
});

test("ne s'affiche pas (pas de carte vide/cassée) sans combiné", () => {
  const { container } = render(<CombinedVisionTicket combo={null} />);
  expect(container).toBeEmptyDOMElement();
});
