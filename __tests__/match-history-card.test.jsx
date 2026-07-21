/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import MatchHistoryCard from "../components/MatchHistoryCard";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function baseEntry(overrides = {}) {
  return {
    id: "1",
    status: "SCHEDULED",
    minute: null,
    utcDate: "2026-07-20T18:00:00Z",
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
    score: { fullTime: { home: null, away: null } },
    addedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  pushMock.mockClear();
});

test("affiche les équipes du match consulté", () => {
  render(<MatchHistoryCard entry={baseEntry()} />);
  expect(screen.getByText("Arsenal FC")).toBeInTheDocument();
  expect(screen.getByText("Chelsea FC")).toBeInTheDocument();
});

test("n'affiche AUCUN bouton Analyser (voir PROMPT)", () => {
  render(<MatchHistoryCard entry={baseEntry()} />);
  expect(screen.queryByRole("button", { name: /analyser/i })).not.toBeInTheDocument();
});

test("cliquer sur la carte renvoie vers la page du match, avec ses infos", () => {
  render(<MatchHistoryCard entry={baseEntry()} />);
  fireEvent.click(screen.getByTestId("match-history-card"));

  expect(pushMock).toHaveBeenCalledTimes(1);
  const href = pushMock.mock.calls[0][0];
  expect(href.pathname).toBe("/match/1");
  expect(href.query).toEqual(
    expect.objectContaining({
      homeTeamId: 10, awayTeamId: 11, homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC", competitionCode: "PL",
    })
  );
});

test("un match terminé transporte bien son statut FINISHED dans le lien (page du match affichera \"Match terminé\")", () => {
  render(<MatchHistoryCard entry={baseEntry({ status: "FINISHED", score: { fullTime: { home: 2, away: 1 } } })} />);
  fireEvent.click(screen.getByTestId("match-history-card"));
  const href = pushMock.mock.calls[0][0];
  expect(href.query.status).toBe("FINISHED");
});

test("la carte est un vrai bouton accessible (pas un <div> muet au clic)", () => {
  render(<MatchHistoryCard entry={baseEntry()} />);
  expect(screen.getByTestId("match-history-card").tagName).toBe("BUTTON");
});
