/**
 * @jest-environment jsdom
 *
 * components/ExternalMatchesWidget.js — widget "compétitions spécifiques" / "tous les
 * clubs" (deux prompts) : appel direct navigateur vers l'API ESPN (aucune route /api de
 * Blume), squelette visible immédiatement, actualisation automatique toutes les 5
 * minutes, jamais un match inventé si l'API ne répond pas.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import ExternalMatchesWidget from "../components/ExternalMatchesWidget";

const pushMock = jest.fn();
jest.mock("next/router", () => ({ useRouter: () => ({ push: pushMock }) }));

function leagues() {
  return [
    { slug: "uefa.champions", label: "Ligue des Champions" },
    { slug: "rus.1", label: "Premier League russe" },
  ];
}

function espnResponse(events) {
  return { ok: true, json: () => Promise.resolve({ events }) };
}

function liveEvent(id, homeName, awayName) {
  return {
    id,
    date: "2026-08-10T18:00:00Z",
    competitions: [
      {
        date: "2026-08-10T18:00:00Z",
        status: { displayClock: "20'", type: { name: "STATUS_IN_PROGRESS", state: "in" } },
        competitors: [
          { homeAway: "home", score: "1", team: { id: `${id}-h`, displayName: homeName } },
          { homeAway: "away", score: "0", team: { id: `${id}-a`, displayName: awayName } },
        ],
      },
    ],
  };
}

beforeEach(() => {
  pushMock.mockClear();
});

afterEach(() => {
  delete global.fetch;
  jest.useRealTimers();
});

test("affiche un squelette visible immédiatement, avant toute réponse réseau", () => {
  global.fetch = jest.fn(() => new Promise(() => {})); // ne répond jamais
  render(<ExternalMatchesWidget title="Test" leagues={leagues()} testId="w" />);
  expect(screen.getByTestId("w-skeleton")).toBeInTheDocument();
});

test("appelle bien chaque championnat demandé, sans clé API, et affiche les vrais matchs reçus", async () => {
  global.fetch = jest.fn((url) => {
    expect(url).not.toMatch(/apikey|api_key|token/i);
    if (url.includes("uefa.champions")) return Promise.resolve(espnResponse([liveEvent("1", "Real Madrid", "Man City")]));
    if (url.includes("rus.1")) return Promise.resolve(espnResponse([liveEvent("2", "Zenit", "Spartak Moscou")]));
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<ExternalMatchesWidget title="Test" leagues={leagues()} testId="w" />);

  await waitFor(() => expect(screen.getByTestId("w-list")).toBeInTheDocument());
  expect(screen.getByText("Real Madrid")).toBeInTheDocument();
  expect(screen.getByText("Zenit")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test("une des deux ligues échoue : l'autre s'affiche quand même (jamais tout ou rien)", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("uefa.champions")) return Promise.resolve(espnResponse([liveEvent("1", "Real Madrid", "Man City")]));
    return Promise.resolve({ ok: false, status: 500 });
  });

  render(<ExternalMatchesWidget title="Test" leagues={leagues()} testId="w" />);
  await waitFor(() => expect(screen.getByTestId("w-list")).toBeInTheDocument());
  expect(screen.getByText("Real Madrid")).toBeInTheDocument();
});

test("les deux ligues échouent : message honnête, jamais un match inventé", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
  render(<ExternalMatchesWidget title="Test" leagues={leagues()} testId="w" />);
  await waitFor(() => expect(screen.getByText(/Impossible de charger les matchs/)).toBeInTheDocument());
  expect(screen.queryByTestId("w-list")).not.toBeInTheDocument();
});

test("aucun match actuellement sur ces compétitions : message honnête, pas un plantage", async () => {
  global.fetch = jest.fn(() => Promise.resolve(espnResponse([])));
  render(<ExternalMatchesWidget title="Test" leagues={leagues()} testId="w" />);
  await waitFor(() => expect(screen.getByText(/Aucun match trouvé/)).toBeInTheDocument());
});

test("le bouton ANALYSER d'un match du widget mène vers /match/[id], comme partout ailleurs sur Blume", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("uefa.champions")) return Promise.resolve(espnResponse([liveEvent("1", "Real Madrid", "Man City")]));
    return Promise.resolve(espnResponse([]));
  });
  render(<ExternalMatchesWidget title="Test" leagues={leagues()} testId="w" />);
  await waitFor(() => expect(screen.getByText("ANALYSER")).toBeInTheDocument());

  const { fireEvent } = require("@testing-library/react");
  fireEvent.click(screen.getByText("ANALYSER"));
  expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/match/espn-uefa.champions-1" }));
});

test("se recharge automatiquement toutes les 5 minutes", async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(() => Promise.resolve(espnResponse([liveEvent("1", "Real Madrid", "Man City")])));
  render(<ExternalMatchesWidget title="Test" leagues={leagues()} testId="w" />);

  await act(async () => {
    await Promise.resolve();
  });
  const callsAfterMount = global.fetch.mock.calls.length;
  expect(callsAfterMount).toBeGreaterThan(0);

  await act(async () => {
    jest.advanceTimersByTime(5 * 60 * 1000);
    await Promise.resolve();
  });
  expect(global.fetch.mock.calls.length).toBeGreaterThan(callsAfterMount);
});

test("minMatches : affiche une note honnête quand moins de matchs que demandé sont disponibles, sans jamais en inventer", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("uefa.champions")) return Promise.resolve(espnResponse([liveEvent("1", "Real Madrid", "Man City")]));
    return Promise.resolve(espnResponse([]));
  });
  render(<ExternalMatchesWidget title="Test" leagues={leagues()} minMatches={6} testId="w" />);
  await waitFor(() => expect(screen.getByTestId("w-list")).toBeInTheDocument());
  expect(screen.getByText(/Seulement 1 match disponible/)).toBeInTheDocument();
  expect(screen.getAllByTestId("match-card")).toHaveLength(1);
});
