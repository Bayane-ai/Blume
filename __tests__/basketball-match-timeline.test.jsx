/**
 * @jest-environment jsdom
 *
 * components/BasketballMatchTimeline.js — bloc 4 : jamais "Événement non disponible"
 * une fois qu'un événement existe, ordre chronologique inversé (le plus récent en
 * premier, comme components/MatchTimeline.js côté football).
 */
import { render, screen } from "@testing-library/react";
import BasketballMatchTimeline from "../components/BasketballMatchTimeline";

function events() {
  return [
    { id: "kickoff", kind: "KICKOFF", label: "Coup d'envoi" },
    { id: "quarter-end-1", kind: "QUARTER_END", label: "Fin du 1er quart-temps : 28 - 22", quarter: "Q1" },
    { id: "lead-1", kind: "LEAD_CHANGE", label: "Changement de leader : 30 - 32", quarter: "Q2", clock: "8:15" },
    { id: "run-1", kind: "RUN", label: "Série de 8-0 pour Lakers (40 - 32)", quarter: "Q2", clock: "5:00" },
  ];
}

test("tableau vide : message honnête d'attente, jamais 'Événement non disponible'", () => {
  render(<BasketballMatchTimeline events={[]} />);
  expect(screen.getByText("En attente du coup d'envoi.")).toBeInTheDocument();
  expect(screen.queryByText(/non disponible/i)).not.toBeInTheDocument();
});

test("events null : même message honnête, jamais un plantage", () => {
  render(<BasketballMatchTimeline events={null} />);
  expect(screen.getByText("En attente du coup d'envoi.")).toBeInTheDocument();
});

test("affiche chaque événement, du plus récent au plus ancien", () => {
  render(<BasketballMatchTimeline events={events()} />);
  const rows = screen.getAllByTestId("basket-timeline-event");
  expect(rows).toHaveLength(4);
  expect(rows[0].textContent).toContain("Série de 8-0 pour Lakers");
  expect(rows[1].textContent).toContain("Changement de leader");
  expect(rows[2].textContent).toContain("Fin du 1er quart-temps");
  expect(rows[3].textContent).toContain("Coup d'envoi");
});

test("affiche le quart-temps/chrono quand disponible", () => {
  render(<BasketballMatchTimeline events={events()} />);
  expect(screen.getByText("Q2 · 8:15")).toBeInTheDocument();
});

test("affiche la note de limitation quand fournie", () => {
  render(<BasketballMatchTimeline events={events()} timelineNote="Note de test" />);
  expect(screen.getByText("Note de test")).toBeInTheDocument();
});
