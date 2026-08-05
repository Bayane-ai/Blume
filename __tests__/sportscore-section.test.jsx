/**
 * @jest-environment jsdom
 *
 * components/SportScoreSection.js + pages/matchs-du-jour.js — les deux sections
 * "Matchs de football à venir" / "Matchs de tennis à venir" : appel direct navigateur
 * vers l'API publique SportScore (sans clé, sans backend), rechargement automatique
 * toutes les 5 minutes, affichage de secours lisible, attribution dofollow obligatoire,
 * et AUCUN bouton ni lien de paiement (affichage purement informatif).
 */
import { render, screen, waitFor, within, act } from "@testing-library/react";
import SportScoreSection from "../components/SportScoreSection";
import MatchsDuJour from "../pages/matchs-du-jour";

jest.mock("next/router", () => ({ useRouter: () => ({ pathname: "/matchs-du-jour", push: jest.fn(), replace: jest.fn() }) }));
jest.mock("../lib/useRequireAuth", () => ({
  useRequireAuth: () => ({ session: { email: "test@example.com" }, sessionChecked: true, authorized: true }),
}));

function payload(matches) {
  return { ok: true, json: () => Promise.resolve({ matches }) };
}

function footballMatches() {
  return [
    {
      id: 1, home_team: { name: "Amical A", logo: "https://x/a.png" }, away_team: { name: "Amical B", logo: "https://x/b.png" },
      league: { name: "Club Friendlies" }, start_at: "2026-08-10T10:00:00Z", status: "not_started",
    },
    {
      id: 2, home_team: { name: "Real Madrid", logo: "https://x/rm.png" }, away_team: { name: "Manchester City", logo: "https://x/mc.png" },
      league: { name: "UEFA Champions League" }, start_at: "2026-08-10T20:00:00Z", status: "not_started",
    },
  ];
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  delete global.fetch;
  jest.useRealTimers();
});

describe("contenu par défaut : une section n'est JAMAIS vide", () => {
  test("un squelette est visible immédiatement, avant même la réponse de l'API", () => {
    global.fetch = jest.fn(() => new Promise(() => {})); // ne répond jamais
    render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);
    const skeleton = screen.getByTestId("sportscore-skeleton");
    expect(skeleton).toBeInTheDocument();
    // Au moins 6 blocs, comme le minimum de matchs demandé par section.
    expect(skeleton.querySelectorAll("li").length).toBeGreaterThanOrEqual(6);
  });

  test("le squelette ne contient aucune fausse donnée (ni équipe, ni horaire inventés)", () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);
    const skeleton = screen.getByTestId("sportscore-skeleton");
    expect(skeleton.textContent.trim()).toBe("");
    expect(screen.queryAllByTestId("sportscore-match")).toHaveLength(0);
  });

  test("visite suivante : les derniers vrais matchs connus s'affichent immédiatement, avant la réponse de l'API", async () => {
    window.localStorage.setItem(
      "blume_sportscore_football",
      JSON.stringify({
        savedAt: Date.now(),
        matches: [{ id: "ss-football-9", home: { name: "Équipe En Cache" }, away: { name: "Adversaire" }, competition: "Ligue 1", startTime: "2026-08-10T18:00:00Z", status: "upcoming" }],
      })
    );
    global.fetch = jest.fn(() => new Promise(() => {})); // l'API ne répond pas encore
    render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);

    expect(await screen.findByText("Équipe En Cache")).toBeInTheDocument();
    expect(screen.queryByTestId("sportscore-skeleton")).not.toBeInTheDocument();
  });

  test("une réponse réelle remplace le cache et le met à jour", async () => {
    global.fetch = jest.fn(() => Promise.resolve(payload(footballMatches())));
    render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);
    await waitFor(() => expect(screen.getByText("Real Madrid")).toBeInTheDocument());

    const cached = JSON.parse(window.localStorage.getItem("blume_sportscore_football"));
    expect(cached.matches.some((m) => m.home.name === "Real Madrid")).toBe(true);
  });
});

describe("un rafraîchissement raté ne vide jamais la section", () => {
  test("l'affichage précédent est conservé quand un rafraîchissement échoue", async () => {
    jest.useFakeTimers();
    let call = 0;
    global.fetch = jest.fn(() => {
      call += 1;
      return call === 1 ? Promise.resolve(payload(footballMatches())) : Promise.reject(new Error("panne réseau"));
    });

    render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Real Madrid")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();
    });

    // Toujours affiché : jamais vidé, jamais remplacé par un message d'erreur.
    expect(screen.getByText("Real Madrid")).toBeInTheDocument();
    expect(screen.queryByTestId("ss-f-fallback")).not.toBeInTheDocument();
  });

  test("une réponse vide ne vide pas non plus une section déjà remplie", async () => {
    jest.useFakeTimers();
    let call = 0;
    global.fetch = jest.fn(() => {
      call += 1;
      return Promise.resolve(payload(call === 1 ? footballMatches() : []));
    });

    render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Real Madrid")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();
    });
    expect(screen.getByText("Real Madrid")).toBeInTheDocument();
  });
});

test("affiche les vrais matchs reçus : noms, logos, compétition, horaire et statut", async () => {
  global.fetch = jest.fn(() => Promise.resolve(payload(footballMatches())));
  render(<SportScoreSection sport="football" title="Matchs de football à venir" testId="ss-f" />);

  await waitFor(() => expect(screen.getByTestId("ss-f-list")).toBeInTheDocument());
  expect(screen.getByText("Real Madrid")).toBeInTheDocument();
  expect(screen.getByText("Manchester City")).toBeInTheDocument();
  expect(screen.getByText("UEFA Champions League")).toBeInTheDocument();
  expect(screen.getAllByTestId("sportscore-status-upcoming").length).toBe(2);
  // Les logos fournis par l'API sont bien rendus.
  const imgs = screen.getByTestId("ss-f-list").querySelectorAll("img");
  expect(imgs.length).toBe(4);
  expect(imgs[0]).toHaveAttribute("src", "https://x/rm.png");
});

test("les grandes compétitions sont affichées en haut de liste, sans jamais écarter les amicaux", async () => {
  global.fetch = jest.fn(() => Promise.resolve(payload(footballMatches())));
  render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);

  await waitFor(() => expect(screen.getByTestId("ss-f-list")).toBeInTheDocument());
  const cards = screen.getAllByTestId("sportscore-match");
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).getByText("UEFA Champions League")).toBeInTheDocument();
  expect(within(cards[1]).getByText("Club Friendlies")).toBeInTheDocument();
});

test("appelle la bonne URL SportScore pour chaque sport, sans aucune clé API", async () => {
  global.fetch = jest.fn(() => Promise.resolve(payload([])));
  render(<SportScoreSection sport="tennis" title="Tennis" testId="ss-t" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const url = global.fetch.mock.calls[0][0];
  expect(url).toBe("https://sportscore.com/api/widget/matches/?sport=tennis&limit=50");
  expect(url).not.toMatch(/key|token/i);
});

test("statut réel affiché : un match en direct ou terminé n'est jamais présenté comme à venir", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve(
      payload([
        { id: 1, home_team: { name: "A" }, away_team: { name: "B" }, league: { name: "ATP Metz" }, status: "live" },
        { id: 2, home_team: { name: "C" }, away_team: { name: "D" }, league: { name: "ATP Metz" }, status: "finished" },
      ])
    )
  );
  render(<SportScoreSection sport="tennis" title="Tennis" testId="ss-t" />);
  await waitFor(() => expect(screen.getByTestId("ss-t-list")).toBeInTheDocument());
  expect(screen.getByTestId("sportscore-status-live")).toHaveTextContent("En direct");
  expect(screen.getByTestId("sportscore-status-finished")).toHaveTextContent("Terminé");
});

test("API en erreur : message de secours clair, jamais une section vide ni cassée, jamais un faux match", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
  render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);

  await waitFor(() => expect(screen.getByTestId("ss-f-fallback")).toBeInTheDocument());
  expect(screen.getByTestId("ss-f-fallback")).toHaveTextContent(/aucune source de matchs n'a pu être jointe/i);
  // La cause technique réelle n'est plus masquée par le message générique.
  expect(screen.getByTestId("ss-f-error-detail")).toHaveTextContent(/HTTP 500/);
  expect(screen.queryByTestId("ss-f-list")).not.toBeInTheDocument();
  // L'attribution reste visible même en cas de panne.
  expect(screen.getByRole("link", { name: "SportScore" })).toBeInTheDocument();
});

test("réseau totalement indisponible : même repli lisible, jamais un plantage", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("network unreachable")));
  render(<SportScoreSection sport="tennis" title="Tennis" testId="ss-t" />);
  await waitFor(() => expect(screen.getByTestId("ss-t-fallback")).toBeInTheDocument());
});

test("attribution « Powered by SportScore » présente, en lien DOFOLLOW vers sportscore.com", async () => {
  global.fetch = jest.fn(() => Promise.resolve(payload([])));
  render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());

  const link = screen.getByRole("link", { name: "SportScore" });
  expect(link).toHaveAttribute("href", "https://sportscore.com/");
  // Dofollow : rel ne doit surtout pas contenir "nofollow" (condition d'utilisation
  // de l'offre gratuite).
  expect(link.getAttribute("rel") || "").not.toMatch(/nofollow/);
});

test("se recharge automatiquement toutes les 5 minutes", async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(() => Promise.resolve(payload(footballMatches())));
  render(<SportScoreSection sport="football" title="Football" testId="ss-f" />);

  await act(async () => { await Promise.resolve(); });
  const initial = global.fetch.mock.calls.length;
  expect(initial).toBeGreaterThan(0);

  await act(async () => {
    jest.advanceTimersByTime(5 * 60 * 1000);
    await Promise.resolve();
  });
  expect(global.fetch.mock.calls.length).toBeGreaterThan(initial);
});

describe("pages/matchs-du-jour.js", () => {
  test("affiche les trois sections demandées, chacune avec son attribution", async () => {
    global.fetch = jest.fn(() => Promise.resolve(payload(footballMatches())));
    render(<MatchsDuJour />);

    expect(await screen.findByText("Matchs de football à venir")).toBeInTheDocument();
    expect(screen.getByText("Matchs de tennis à venir")).toBeInTheDocument();
    expect(screen.getByText("Matchs de basketball à venir")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "SportScore" })).toHaveLength(3));
  });

  test("interroge bien football, tennis ET basketball", async () => {
    global.fetch = jest.fn(() => Promise.resolve(payload([])));
    render(<MatchsDuJour />);
    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(3));
    const urls = global.fetch.mock.calls.map(([u]) => u);
    expect(urls).toEqual(expect.arrayContaining([
      "https://sportscore.com/api/widget/matches/?sport=football&limit=50",
      "https://sportscore.com/api/widget/matches/?sport=tennis&limit=50",
      "https://sportscore.com/api/widget/matches/?sport=basketball&limit=50",
    ]));
  });

  test("aucune section n'est vide au chargement : les trois affichent un contenu par défaut", async () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    render(<MatchsDuJour />);
    expect(await screen.findAllByTestId("sportscore-skeleton")).toHaveLength(3);
  });

  test("aucun bouton ni lien de paiement : affichage purement informatif", async () => {
    global.fetch = jest.fn(() => Promise.resolve(payload(footballMatches())));
    render(<MatchsDuJour />);
    await waitFor(() => expect(screen.getAllByTestId("sportscore-match").length).toBeGreaterThan(0));

    expect(screen.queryByRole("button", { name: /analyser/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/payer|paiement|checkout|s'abonner/i)).not.toBeInTheDocument();
    // Le seul lien des sections est l'attribution SportScore (le reste des liens de la
    // page appartient à la navigation du site).
    const cards = screen.getAllByTestId("sportscore-match");
    cards.forEach((c) => expect(c.querySelectorAll("a")).toHaveLength(0));
  });
});
