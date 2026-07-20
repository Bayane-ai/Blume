/**
 * @jest-environment jsdom
 *
 * Bloc 3 — Moments forts : test complet qui vérifie que, pour un match EN DIRECT :
 * 1) la timeline (buts, cartons, remplacements) est épinglée en haut de la page,
 *    juste sous le score, avant le reste du contenu (position: sticky) ;
 * 2) chaque type d'événement s'affiche correctement (buteur + minute, cartons,
 *    remplacements, séparateur mi-temps, alignement par équipe) à l'intérieur de ce
 *    panneau épinglé ;
 * 3) le message "Événements non disponibles pour ce match." n'apparaît JAMAIS pour
 *    un match réellement en direct — quel que soit le scénario (aucune source
 *    connectée, aucun événement pour l'instant, ou même un échec complet du premier
 *    appel à /api/analyze) ;
 * 4) les nouveaux événements apparaissent automatiquement au fil du match, sans
 *    recharger la page.
 *
 * Limite de cet environnement : jsdom ne fait pas de vrai rendu visuel ni de vrai
 * défilement — "reste épinglée au défilement" est donc vérifié ici via la propriété
 * CSS réelle (position: sticky; top: 0), le comportement de défilement dans un vrai
 * navigateur étant déjà couvert par la suite E2E Playwright (e2e/full-journey.spec.js,
 * qui fait défiler la page pour de vrai et vérifie que le panneau reste dans le
 * viewport). Aucun accès réseau sortant vers football-data.org/api-football.com
 * depuis cette sandbox (déjà documenté dans ce projet) : réseau simulé, comme le
 * reste de la suite.
 */
import { render, screen, waitFor, within, act } from "@testing-library/react";
import MatchPage from "../pages/match/[id]";

let mockRouter;
jest.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { email: "test@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
  },
}));

function liveQuery(overrides = {}) {
  return {
    id: "1", competitionCode: "PL", homeTeamId: "10", awayTeamId: "11",
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
    status: "IN_PLAY", minute: "30", utcDate: new Date().toISOString(),
    scoreHome: "1", scoreAway: "0",
    ...overrides,
  };
}

function analyzeResponse(overrides = {}) {
  return {
    available: true, live: true,
    home: { name: "Arsenal FC" }, away: { name: "Chelsea FC" },
    probabilities: { home: 55, draw: 25, away: 20 },
    goals: { expectedHome: 1.6, expectedAway: 1.1, over25: 54, bttsYes: 58 },
    correctScores: [{ score: "2-1", probability: 15 }],
    note: "note",
    matchStatus: "IN_PLAY", matchMinute: 30, matchScore: { home: 1, away: 0 },
    ...overrides,
  };
}

const FULL_EVENTS = [
  { id: "e1", minute: 5, type: "GOAL", teamId: "10", player: { name: "Bukayo Saka" }, scoreAfter: { home: 1, away: 0 } },
  { id: "e2", minute: 30, type: "YELLOW_CARD", teamId: "11", player: { name: "Reece James" } },
  { id: "e3", minute: 52, type: "SUBSTITUTION", teamId: "10", playerIn: { name: "Gabriel Jesus" }, playerOut: { name: "Eddie Nketiah" } },
  { id: "e4", minute: 78, type: "GOAL", teamId: "11", player: { name: "Cole Palmer" }, scoreAfter: { home: 1, away: 1 } },
  { id: "e5", minute: 90, type: "RED_CARD", teamId: "10", player: { name: "Declan Rice" } },
];

// ---------------------------------------------------------------------------
// 1) Épinglée en haut, juste sous le score, avant le reste du contenu.
// ---------------------------------------------------------------------------
test("le panneau \"Moments forts\" est épinglé (position: sticky, top: 0) juste après l'en-tête, avant les pronostics", async () => {
  mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: liveQuery() };
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ events: FULL_EVENTS })) }));

  render(<MatchPage />);

  const pinned = await screen.findByTestId("pinned-highlights");
  expect(pinned).toHaveStyle({ position: "sticky", top: "0px" });

  // Vient tout de suite après l'en-tête (score) dans le document, avant les pronostics.
  const header = screen.getByTestId("live-score").closest("header");
  expect(header.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const pronosticHeading = await screen.findByText("Pronostics automatiques");
  expect(pinned.compareDocumentPosition(pronosticHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 2) Chaque type d'événement s'affiche correctement dans le panneau épinglé.
// ---------------------------------------------------------------------------
test("buts (buteur + minute), carton jaune, carton rouge, remplacement et séparateur mi-temps s'affichent tous dans le panneau épinglé, alignés par équipe", async () => {
  mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: liveQuery() };
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ events: FULL_EVENTS })) }));

  render(<MatchPage />);
  const pinned = await screen.findByTestId("pinned-highlights");
  await within(pinned).findByText("Bukayo Saka");

  // Les 5 événements réels sont bien présents.
  expect(within(pinned).getByText("Bukayo Saka")).toBeInTheDocument();
  expect(within(pinned).getByText("Reece James")).toBeInTheDocument();
  expect(within(pinned).getByText(/Gabriel Jesus.*Eddie Nketiah|Eddie Nketiah.*Gabriel Jesus/)).toBeInTheDocument();
  expect(within(pinned).getByText("Cole Palmer")).toBeInTheDocument();
  expect(within(pinned).getByText("Declan Rice")).toBeInTheDocument();
  expect(within(pinned).getByText("Mi-temps")).toBeInTheDocument();
  expect(within(pinned).getByText("Coup d'envoi")).toBeInTheDocument();

  // Score après chaque but affiché à côté de l'événement.
  expect(within(pinned).getByText("1 - 0")).toBeInTheDocument();
  expect(within(pinned).getByText("1 - 1")).toBeInTheDocument();

  // Icônes distinctes par type d'événement.
  expect(within(pinned).getAllByRole("img", { name: "But" })).toHaveLength(2);
  expect(within(pinned).getByRole("img", { name: "Carton jaune" })).toBeInTheDocument();
  expect(within(pinned).getByRole("img", { name: "Carton rouge" })).toBeInTheDocument();
  expect(within(pinned).getByRole("img", { name: "Remplacement" })).toBeInTheDocument();

  // Alignement par équipe : le but de Bukayo Saka (domicile) à gauche, celui de Cole
  // Palmer (extérieur) à droite.
  const rows = within(pinned).getAllByTestId("timeline-event");
  const homeRow = rows.find((r) => r.textContent.includes("Bukayo Saka"));
  const awayRow = rows.find((r) => r.textContent.includes("Cole Palmer"));
  expect(homeRow).toHaveStyle({ justifyContent: "flex-start" });
  expect(awayRow).toHaveStyle({ justifyContent: "flex-end" });
});

// ---------------------------------------------------------------------------
// 3) "Événements non disponibles pour ce match." n'apparaît jamais pour un match en
//    direct, quel que soit le scénario.
// ---------------------------------------------------------------------------
describe("Bloc 3.3 — jamais \"indisponible\" pour un match réellement en direct", () => {
  test("aucune source connectée (events null) : \"Coup d'envoi — en attente des premiers événements.\"", async () => {
    mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: liveQuery() };
    global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ events: null })) }));

    render(<MatchPage />);
    const pinned = await screen.findByTestId("pinned-highlights");
    await waitFor(() => expect(within(pinned).getByTestId("timeline-empty")).toHaveTextContent("Coup d'envoi — en attente des premiers événements."));
    expect(within(pinned).queryByText("Événements non disponibles pour ce match.")).not.toBeInTheDocument();
  });

  test("source connectée mais aucun événement pour l'instant (events []) : même message optimiste, jamais \"indisponible\"", async () => {
    mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: liveQuery({ minute: "2", scoreHome: "0", scoreAway: "0" }) };
    global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ events: [], matchMinute: 2, matchScore: { home: 0, away: 0 } })) }));

    render(<MatchPage />);
    const pinned = await screen.findByTestId("pinned-highlights");
    await waitFor(() => expect(within(pinned).getByTestId("timeline-empty")).toHaveTextContent("Coup d'envoi — en attente des premiers événements."));
    expect(within(pinned).queryByText("Événements non disponibles pour ce match.")).not.toBeInTheDocument();
  });

  test("même si le tout premier appel à /api/analyze échoue complètement, un match live (d'après les query params) n'affiche jamais \"indisponible\"", async () => {
    mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: liveQuery() };
    global.fetch = jest.fn(() => Promise.reject(new Error("Erreur réseau simulée")));

    render(<MatchPage />);

    // Le panneau épinglé s'affiche dès le premier rendu (statut IN_PLAY connu via les
    // query params, indépendamment du succès de l'appel réseau).
    const pinned = await screen.findByTestId("pinned-highlights");
    expect(within(pinned).getByTestId("timeline-empty")).toHaveTextContent("Coup d'envoi — en attente des premiers événements.");
    expect(within(pinned).queryByText("Événements non disponibles pour ce match.")).not.toBeInTheDocument();
  });

  test("le serveur renvoie une erreur explicite ({error: ...}) pour ce match live : toujours pas \"indisponible\"", async () => {
    mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: liveQuery() };
    global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ error: "Erreur lors du calcul des pronostics." }) }));

    render(<MatchPage />);
    const pinned = await screen.findByTestId("pinned-highlights");
    expect(within(pinned).getByTestId("timeline-empty")).toHaveTextContent("Coup d'envoi — en attente des premiers événements.");
    expect(within(pinned).queryByText("Événements non disponibles pour ce match.")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4) Les nouveaux événements apparaissent automatiquement, sans recharger la page.
// ---------------------------------------------------------------------------
test("un nouveau but marqué au cycle suivant apparaît automatiquement dans le panneau épinglé, sans recharger la page", async () => {
  mockRouter = { pathname: "/match/1", isReady: true, replace: jest.fn(), query: liveQuery({ minute: "10", scoreHome: "0", scoreAway: "0" }) };

  let call = 0;
  global.fetch = jest.fn(() => {
    call += 1;
    if (call === 1) {
      return Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ events: [], matchMinute: 10, matchScore: { home: 0, away: 0 } })) });
    }
    return Promise.resolve({
      json: () => Promise.resolve(analyzeResponse({
        events: [{ id: "new-goal", minute: 34, type: "GOAL", teamId: "10", player: { name: "Martin Ødegaard" }, scoreAfter: { home: 1, away: 0 } }],
        matchMinute: 34, matchScore: { home: 1, away: 0 },
      })),
    });
  });

  render(<MatchPage />);
  const pinned = await screen.findByTestId("pinned-highlights");
  await waitFor(() => expect(within(pinned).getByTestId("timeline-empty")).toBeInTheDocument());
  expect(within(pinned).queryByText("Martin Ødegaard")).not.toBeInTheDocument();

  await act(async () => {
    await new Promise((r) => setTimeout(r, 2200));
  });

  await waitFor(() => expect(within(pinned).getByText("Martin Ødegaard")).toBeInTheDocument());
  expect(within(pinned).queryByTestId("timeline-empty")).not.toBeInTheDocument();
  expect(call).toBeGreaterThan(1);
}, 10000);

// ---------------------------------------------------------------------------
// Garde-fou : un match NON live conserve le comportement d'origine (pas épinglé,
// distinction "indisponible" / "aucun événement" toujours valable).
// ---------------------------------------------------------------------------
test("un match terminé n'est pas concerné : \"Moments forts\" reste en bas de page, non épinglé, avec le message d'origine", async () => {
  mockRouter = {
    pathname: "/match/2", isReady: true, replace: jest.fn(),
    query: liveQuery({ id: "2", status: "FINISHED", minute: "90", scoreHome: "3", scoreAway: "1" }),
  };
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve(analyzeResponse({ live: false, matchStatus: undefined, events: null })) }));

  render(<MatchPage />);
  await screen.findByText("Moments forts");
  expect(screen.queryByTestId("pinned-highlights")).not.toBeInTheDocument();
  expect(screen.getByText("Événements non disponibles pour ce match.")).toBeInTheDocument();
});
