/**
 * @jest-environment jsdom
 *
 * En-tête d'un match en direct : flèche de retour + nom de la compétition centré,
 * logo/nom de chaque équipe de part et d'autre du score réel ("X - X"), minute en
 * direct en dessous. Score et minute viennent toujours des vraies données transmises
 * en props, jamais une valeur inventée.
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import MatchHeaderHero from "../components/MatchHeaderHero";

const pushMock = jest.fn();
const backMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  backMock.mockClear();
});

function liveMatch(overrides = {}) {
  return {
    competition: { name: "Premier League" },
    homeTeam: { name: "Arsenal FC", crest: "https://example.com/arsenal.png" },
    awayTeam: { name: "Chelsea FC", crest: "https://example.com/chelsea.png" },
    score: { fullTime: { home: 2, away: 1 } },
    minute: 67,
    utcDate: new Date().toISOString(),
    ...overrides,
  };
}

test("un match en direct affiche : flèche de retour, compétition centrée, équipes de part et d'autre, vrai score \"X - X\", vraie minute en direct", () => {
  render(<MatchHeaderHero m={liveMatch()} isLive />);

  expect(screen.getByRole("button", { name: "Retour" })).toBeInTheDocument();
  expect(screen.getByText("Premier League")).toBeInTheDocument();
  expect(screen.getByText("Arsenal FC")).toBeInTheDocument();
  expect(screen.getByText("Chelsea FC")).toBeInTheDocument();

  // Score réel, jamais inventé, au format "X - X".
  expect(screen.getByTestId("live-score")).toHaveTextContent("2 - 1");
  // Minute en direct, couleur vive dédiée (voir le style rouge/orange du composant).
  expect(screen.getByTestId("live-minute")).toHaveTextContent("67’");
});

test("un match pas encore commencé affiche l'heure du coup d'envoi à la place du score, et aucune minute en direct", () => {
  const upcoming = liveMatch({
    score: { fullTime: { home: null, away: null } },
    minute: null,
    utcDate: "2026-08-01T18:30:00Z",
  });
  render(<MatchHeaderHero m={upcoming} isLive={false} />);

  expect(screen.queryByTestId("live-score")).not.toBeInTheDocument();
  expect(screen.queryByTestId("live-minute")).not.toBeInTheDocument();
  expect(screen.getByTestId("header-kickoff")).toBeInTheDocument();
});

test("un match terminé (non live) affiche le score final mais pas de minute en direct", () => {
  const finished = liveMatch({ minute: 90 });
  render(<MatchHeaderHero m={finished} isLive={false} />);

  expect(screen.getByTestId("live-score")).toHaveTextContent("2 - 1");
  expect(screen.queryByTestId("live-minute")).not.toBeInTheDocument();
});

test("le score se met à jour tout seul si les props changent (vrai score temps réel, jamais figé)", () => {
  const { rerender } = render(<MatchHeaderHero m={liveMatch({ score: { fullTime: { home: 0, away: 0 } }, minute: 10 })} isLive />);
  expect(screen.getByTestId("live-score")).toHaveTextContent("0 - 0");
  expect(screen.getByTestId("live-minute")).toHaveTextContent("10’");

  rerender(<MatchHeaderHero m={liveMatch({ score: { fullTime: { home: 1, away: 0 } }, minute: 23 })} isLive />);
  expect(screen.getByTestId("live-score")).toHaveTextContent("1 - 0");
  expect(screen.getByTestId("live-minute")).toHaveTextContent("23’");
});

test('un match à la mi-temps (PAUSED) affiche "MT" à la place de la minute', () => {
  const halftime = liveMatch({ status: "PAUSED", minute: 45 });
  render(<MatchHeaderHero m={halftime} isLive />);

  expect(screen.getByTestId("live-score")).toHaveTextContent("2 - 1");
  expect(screen.getByTestId("live-minute")).toHaveTextContent("MT");
});

test("la flèche de retour revient en arrière dans l'historique", () => {
  render(<MatchHeaderHero m={liveMatch()} isLive />);
  fireEvent.click(screen.getByRole("button", { name: "Retour" }));
  expect(backMock).toHaveBeenCalledTimes(1);
});
