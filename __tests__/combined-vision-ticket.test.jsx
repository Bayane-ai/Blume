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
    reason: "Arsenal FC pointe à la 3e place (55 pts), favori selon le modèle statistique.",
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

// BLOC 4.A — justification par sélection, sous chaque pronostic.
test("affiche la justification de chaque sélection, sous le pronostic", () => {
  render(<CombinedVisionTicket combo={combo()} />);
  const reasons = screen.getAllByTestId("ticket-leg-reason");
  expect(reasons).toHaveLength(2);
  expect(reasons[0]).toHaveTextContent("Arsenal FC pointe à la 3e place");
});

test("aucune sélection sans raison réelle : pas de texte de justification affiché (jamais un texte inventé)", () => {
  render(<CombinedVisionTicket combo={combo({ legs: [leg({ reason: undefined })] })} />);
  expect(screen.queryByTestId("ticket-leg-reason")).not.toBeInTheDocument();
});

// BLOC 4.B / BLOC 5 — statut Gagné/Perdu/En cours.
test("statut \"En cours\" par défaut (combiné pas encore classé)", () => {
  render(<CombinedVisionTicket combo={combo()} />);
  expect(screen.getByTestId("ticket-status-badge")).toHaveTextContent("En cours");
});

test("statut \"Gagné\" affiché quand le combiné est classé succès", () => {
  render(<CombinedVisionTicket combo={combo()} progress={{ status: "success", legResults: { 1: true, 2: true } }} />);
  expect(screen.getByTestId("ticket-status-badge")).toHaveTextContent("Gagné");
});

test("statut \"Perdu\" affiché quand le combiné est classé échec, avec un message d'échec auto", () => {
  render(<CombinedVisionTicket combo={combo()} progress={{ status: "failure", legResults: { 1: false, 2: null } }} />);
  expect(screen.getByTestId("ticket-status-badge")).toHaveTextContent("Perdu");
  expect(screen.getByTestId("ticket-failure-message")).toHaveTextContent(/échec/i);
});

// BLOC 5 — les sélections déjà jouées et gagnées apparaissent cochées, les autres
// restent en attente.
test("chaque sélection affiche son propre résultat (gagnée cochée, perdue marquée, en attente sinon)", () => {
  render(<CombinedVisionTicket combo={combo()} progress={{ status: "pending", legResults: { 1: true, 2: null } }} />);
  const results = screen.getAllByTestId("ticket-leg-result");
  expect(results[0]).toHaveTextContent("✓");
  expect(results[0]).toHaveTextContent(/Gagné/i);
  expect(results[1]).toHaveTextContent(/attente/i);
});

test("une sélection perdue est bien marquée comme telle (✗)", () => {
  render(<CombinedVisionTicket combo={combo()} progress={{ status: "failure", legResults: { 1: false, 2: null } }} />);
  const results = screen.getAllByTestId("ticket-leg-result");
  expect(results[0]).toHaveTextContent("✗");
  expect(results[0]).toHaveTextContent(/Perdu/i);
});

test("sans donnée de progression : chaque sélection reste \"en attente\" (jamais un résultat inventé)", () => {
  render(<CombinedVisionTicket combo={combo()} />);
  const results = screen.getAllByTestId("ticket-leg-result");
  expect(results.every((r) => /attente/i.test(r.textContent))).toBe(true);
});

// BLOC 5 — un combiné déjà en échec n'est plus présenté comme une opportunité live.
test("un combiné live déjà en échec n'affiche plus \"saisir l'occasion\"/\"compromis\", seulement le statut \"Perdu\"", () => {
  render(<CombinedVisionTicket combo={combo({ isLive: true })} progress={{ status: "failure", legResults: {} }} />);
  expect(screen.queryByTestId("ticket-live-badge")).not.toBeInTheDocument();
  expect(screen.getByTestId("ticket-status-badge")).toHaveTextContent("Perdu");
});

// BLOC 4.D — une sélection live compromise n'est plus proposée comme une opportunité
// fraîche : mention distincte, jamais "saisir l'occasion".
test("un combiné live compromis affiche \"En live — compromis\", jamais \"saisir l'occasion\"", () => {
  render(<CombinedVisionTicket combo={combo({ isLive: true, compromised: true })} />);
  const badge = screen.getByTestId("ticket-live-badge");
  expect(badge).toHaveTextContent("En live — compromis");
  expect(badge.textContent).not.toMatch(/saisir l'occasion/i);
});

test("un combiné live non compromis garde la mention \"saisir l'occasion\"", () => {
  render(<CombinedVisionTicket combo={combo({ isLive: true, compromised: false })} />);
  expect(screen.getByTestId("ticket-live-badge")).toHaveTextContent("En live — saisir l'occasion");
});
