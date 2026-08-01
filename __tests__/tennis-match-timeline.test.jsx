/**
 * @jest-environment jsdom
 *
 * components/TennisMatchTimeline.js — bloc 8 : jamais "Événement non disponible" une
 * fois qu'un événement existe, ordre chronologique inversé (le plus récent en premier).
 */
import { render, screen } from "@testing-library/react";
import TennisMatchTimeline from "../components/TennisMatchTimeline";

function events() {
  return [
    { id: "start", kind: "START", label: "Début du match" },
    { id: "break-1", kind: "BREAK", label: "Break pour Djokovic (3-2)", scoreAfter: { home: 3, away: 2 } },
    { id: "set-0", kind: "SET_WON", label: "Set 1 remporté par Djokovic (6-4)", scoreAfter: { home: 6, away: 4 } },
    { id: "run-1", kind: "RUN", label: "Série de 3 jeux consécutifs pour Djokovic" },
  ];
}

test("tableau vide : message honnête d'attente, jamais 'Événement non disponible'", () => {
  render(<TennisMatchTimeline events={[]} />);
  expect(screen.getByText("En attente du début du match.")).toBeInTheDocument();
  expect(screen.queryByText(/non disponible/i)).not.toBeInTheDocument();
});

test("events null : même message honnête, jamais un plantage", () => {
  render(<TennisMatchTimeline events={null} />);
  expect(screen.getByText("En attente du début du match.")).toBeInTheDocument();
});

test("affiche chaque événement, du plus récent au plus ancien", () => {
  render(<TennisMatchTimeline events={events()} />);
  const rows = screen.getAllByTestId("tennis-timeline-event");
  expect(rows).toHaveLength(4);
  expect(rows[0].textContent).toContain("Série de 3 jeux consécutifs");
  expect(rows[1].textContent).toContain("Set 1 remporté");
  expect(rows[2].textContent).toContain("Break pour Djokovic");
  expect(rows[3].textContent).toContain("Début du match");
});

test("affiche le score après l'événement quand disponible", () => {
  render(<TennisMatchTimeline events={events()} />);
  expect(screen.getByText("6-4")).toBeInTheDocument();
});

test("affiche la note de limitation quand fournie", () => {
  render(<TennisMatchTimeline events={events()} timelineNote="Note de test" />);
  expect(screen.getByText("Note de test")).toBeInTheDocument();
});
