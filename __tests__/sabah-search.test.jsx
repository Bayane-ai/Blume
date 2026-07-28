/**
 * @jest-environment jsdom
 *
 * Recherche par nom d'équipe (page d'accueil) : une équipe d'une petite fédération
 * jamais répertoriée dans lib/competitions.js (ex : Sabah Baku, Premier League
 * azerbaïdjanaise) doit être trouvée par la recherche texte si l'API la renvoie —
 * exactement comme n'importe quelle autre équipe.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Home from "../pages/index";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { id: "u1", email: "test@example.com" },
    sessionChecked: true,
    authorized: true,
  }),
}));

function liveMatchesFixture() {
  return {
    matches: [
      {
        id: 1, status: "IN_PLAY", minute: 30, utcDate: new Date().toISOString(),
        competition: { code: "AZ1", name: "Premyer Liqa", emblem: "" },
        homeTeam: { id: 100, name: "Sabah Baku", crest: "" },
        awayTeam: { id: 101, name: "Qarabag FK", crest: "" },
        score: { fullTime: { home: 1, away: 1 } },
      },
      {
        id: 2, status: "IN_PLAY", minute: 12, utcDate: new Date().toISOString(),
        competition: { code: "PL", name: "Premier League", emblem: "" },
        homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
        awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
        score: { fullTime: { home: 0, away: 0 } },
      },
    ],
  };
}

function mockFetchRouter() {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/live-matches")) {
      return Promise.resolve({ json: () => Promise.resolve(liveMatchesFixture()) });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

test('une recherche par nom d\'équipe ("Sabah") retrouve le match correspondant, même dans une petite fédération jamais répertoriée', async () => {
  mockFetchRouter();
  render(<Home />);
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(2));

  const input = screen.getByPlaceholderText(/rechercher une équipe/i);
  fireEvent.change(input, { target: { value: "Sabah" } });

  await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(1));
  const list = screen.getByTestId("match-list");
  expect(within(list).getByText("Sabah Baku")).toBeInTheDocument();
  expect(within(list).queryByText("Arsenal FC")).not.toBeInTheDocument();
});

test("la recherche est insensible à la casse et aux accents pour cette même équipe", async () => {
  mockFetchRouter();
  render(<Home />);
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^analyser$/i })).toHaveLength(2));

  const input = screen.getByPlaceholderText(/rechercher une équipe/i);
  fireEvent.change(input, { target: { value: "sabah" } });

  await waitFor(() => {
    const list = screen.getByTestId("match-list");
    expect(within(list).getByText("Sabah Baku")).toBeInTheDocument();
  });
});
