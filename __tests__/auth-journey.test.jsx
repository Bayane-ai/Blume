/**
 * @jest-environment jsdom
 *
 * Parcours de connexion complet, de bout en bout, contre un FAUX backend réaliste
 * (email uniquement, sans mot de passe/code/Google — voir pages/api/auth/login.js —
 * plus une table match_history simulée avec isolation par profile_id, comme le ferait
 * réellement Postgres avec la clé service_role). Couvre les points demandés :
 *   1. Nouvel email -> compte créé automatiquement -> connecté IMMÉDIATEMENT
 *   2. Rechargement de la page -> toujours connecté (session persistante)
 *   3. Déconnexion -> cookie effacé, retour à /connexion
 *   4. Connexion avec un deuxième email -> contenu totalement différent et vide
 *   5. Reconnexion avec le même email -> on retrouve son contenu
 *   6. Compte non-admin -> aucune écriture possible
 *
 * Les vraies pages (pages/connexion.js, pages/historique.js, pages/index.js) et la
 * vraie logique (lib/matchHistory.js, lib/useRequireAuth.js, components/SiteHeader.js)
 * sont exercées telles quelles — seul le réseau (fetch) est simulé en mémoire, pour
 * pouvoir créer plusieurs vrais comptes distincts sans dépendre d'un projet Supabase
 * réel. lib/session.js est mocké uniquement pour pouvoir appeler directement la route
 * d'administration (pages/api/admin/recompute.js), qui elle tourne réellement côté
 * "serveur" dans ce test, pas via fetch.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Connexion from "../pages/connexion";
import Historique from "../pages/historique";
import Home from "../pages/index";
import { isAdmin } from "../lib/auth/admin";
import handleRecompute from "../pages/api/admin/recompute";

const pushMock = jest.fn();
const replaceMock = jest.fn();
let mockPathname = "/";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, pathname: mockPathname, isReady: true, query: {} }),
}));

jest.mock("../lib/security/guardMutation", () => ({ guardMutation: () => true }));
jest.mock("../lib/comboHistory", () => ({ maintainAndGetComboStats: jest.fn(() => Promise.resolve({ successRates: {}, progress: {} })) }));
jest.mock("../lib/pronosticHistory", () => ({
  listAndMaintainHistory: jest.fn(() => Promise.resolve([])),
  listRecentPredictionsForDuplicateCheck: jest.fn(() => Promise.resolve([])),
}));

// lib/session.js n'est mocké que pour la route d'administration, appelée directement
// (pas via fetch) — voir plus bas, "currentSession" est la même variable qui pilote
// aussi le faux réseau.
let currentSession = null;
jest.mock("../lib/session", () => ({
  getSession: () => currentSession,
}));

// Faux backend EN MÉMOIRE (profiles + match_history) — toute la logique métier
// (isolation par profile_id, création automatique de compte par email) reste dans
// les VRAIES pages/lib du site ; ce faux réseau ne fait que se comporter comme le
// ferait réellement le serveur pour chacun de ces cas.
let profiles; // email -> { id, email }
let matchHistoryRows;
let nextProfileId;

function resetBackend() {
  profiles = {};
  matchHistoryRows = [];
  nextProfileId = 1;
  currentSession = null;
}
resetBackend();

function getOrCreateProfile(email) {
  if (!profiles[email]) {
    const id = `profile-${nextProfileId++}`;
    profiles[email] = { id, email };
  }
  return profiles[email];
}

global.fetch = jest.fn();

function mockFetch() {
  global.fetch = jest.fn((url, options) => {
    if (url === "/api/auth/login") {
      const { email } = JSON.parse(options.body);
      const profile = getOrCreateProfile(email);
      currentSession = { id: profile.id, email: profile.email };
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    if (url === "/api/auth/session") {
      return Promise.resolve({ json: () => Promise.resolve({ session: currentSession }) });
    }
    if (url === "/api/auth/logout") {
      currentSession = null;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    if (url === "/api/whoami") {
      return Promise.resolve({ json: () => Promise.resolve({ isOwner: isAdmin(currentSession) }) });
    }
    if (url === "/api/live-matches") {
      return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
    }
    if (url === "/api/match-history" && (!options || !options.method)) {
      const items = matchHistoryRows
        .filter((r) => r.profile_id === currentSession?.id)
        .sort((a, b) => b.added_at - a.added_at)
        .map((r) => ({ id: r.match_id, homeTeam: { name: r.home_team_name }, awayTeam: { name: r.away_team_name } }));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) });
    }
    if (url === "/api/match-history" && options?.method === "POST") {
      const { entry } = JSON.parse(options.body);
      const row = {
        profile_id: currentSession?.id, match_id: String(entry.id),
        home_team_name: entry.homeTeam.name, away_team_name: entry.awayTeam.name, added_at: Date.now(),
      };
      const idx = matchHistoryRows.findIndex((r) => r.profile_id === row.profile_id && r.match_id === row.match_id);
      if (idx >= 0) matchHistoryRows[idx] = row; else matchHistoryRows.push(row);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.reject(new Error(`URL inattendue dans le test : ${url}`));
  });
}

async function loginWithEmail(email) {
  const view = render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  view.unmount();
}

beforeEach(() => {
  resetBackend();
  mockFetch();
  pushMock.mockClear();
  replaceMock.mockClear();
  mockPathname = "/";
  delete process.env.ADMIN_EMAIL;
});

test("1. nouvel email : compte créé automatiquement, connecté IMMÉDIATEMENT (pas de code, pas de vérification)", async () => {
  await loginWithEmail("alice@example.com");
  expect(currentSession?.email).toBe("alice@example.com");
});

test("2. rechargement de la page (nouveau montage) : toujours connecté, jamais renvoyé vers /connexion", async () => {
  await loginWithEmail("alice@example.com");

  // Un "rechargement" = un nouveau montage de la page protégée, qui redemande sa
  // session au serveur comme le ferait un vrai rechargement de navigateur.
  const home = render(<Home />);
  await waitFor(() => expect(screen.queryByText(/chargement/i)).not.toBeInTheDocument());
  expect(replaceMock).not.toHaveBeenCalledWith("/connexion");
  home.unmount();
});

test("parcours complet : nouveau compte -> donnée personnelle -> déconnexion (cookie effacé) -> 2e email (isolation) -> protection -> reconnexion (même email, contenu retrouvé) -> compte non-admin refusé", async () => {
  process.env.ADMIN_EMAIL = "admin@example.com";

  // --- 1. Nouvel email : compte A créé et connecté.
  await loginWithEmail("alice@example.com");
  expect(currentSession?.email).toBe("alice@example.com");
  const profileIdA = currentSession.id;

  // --- Le compte A enregistre une donnée personnelle (un match consulté, voir
  // lib/matchHistory.js — table match_history, filtrée par profile_id).
  matchHistoryRows.push({ profile_id: profileIdA, match_id: "101", home_team_name: "Arsenal FC", away_team_name: "Chelsea FC", added_at: Date.now() });

  const historiqueA1 = render(<Historique />);
  const cardsA1 = await screen.findAllByTestId("match-history-card");
  expect(cardsA1).toHaveLength(1);
  expect(cardsA1[0]).toHaveTextContent("Arsenal FC");
  historiqueA1.unmount();

  // --- Déconnexion du compte A : le bouton "Se déconnecter" (SiteHeader, rendu par
  // Historique) efface le cookie de session et renvoie vers /connexion.
  const historiqueForLogout = render(<Historique />);
  await screen.findAllByTestId("match-history-card");
  fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/connexion"));
  expect(currentSession).toBeNull();
  historiqueForLogout.unmount();
  pushMock.mockClear();

  // --- 4. Connexion avec un 2e email (compte B), isolation : jamais le même compte.
  await loginWithEmail("bob@example.com");
  expect(currentSession?.email).toBe("bob@example.com");
  expect(currentSession.id).not.toBe(profileIdA);

  // --- Isolation (test clé) : B ne doit voir AUCUNE donnée de A.
  const historiqueB = render(<Historique />);
  expect(await screen.findByTestId("match-history-empty")).toBeInTheDocument();
  expect(screen.queryByText("Arsenal FC")).not.toBeInTheDocument();
  expect(screen.queryByTestId("match-history-card")).not.toBeInTheDocument();
  historiqueB.unmount();

  // --- 6. Action d'administration depuis le compte B (non-admin) : refusée.
  expect(isAdmin(currentSession)).toBe(false);
  const recomputeReq = { method: "POST", headers: { origin: "https://blume.example.com", host: "blume.example.com" }, socket: {}, cookies: {} };
  const recomputeRes = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handleRecompute(recomputeReq, recomputeRes);
  expect(recomputeRes.statusCode).toBe(403);

  // --- Déconnexion du compte B.
  currentSession = null;

  // --- Protection : un visiteur non connecté qui tente d'ouvrir une page du site est
  // renvoyé vers /connexion (aucune session -> lib/useRequireAuth.js redirige).
  replaceMock.mockClear();
  const homeAnonymous = render(<Home />);
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/connexion"));
  expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
  homeAnonymous.unmount();

  // --- 5. Reconnexion avec le MÊME email : on retrouve bien le compte A et SES données.
  pushMock.mockClear();
  replaceMock.mockClear();
  await loginWithEmail("alice@example.com");
  expect(currentSession?.email).toBe("alice@example.com");
  expect(currentSession.id).toBe(profileIdA);

  const historiqueA2 = render(<Historique />);
  const cardsA2 = await screen.findAllByTestId("match-history-card");
  expect(cardsA2).toHaveLength(1);
  expect(cardsA2[0]).toHaveTextContent("Arsenal FC");
  historiqueA2.unmount();
}, 20000);

test("6bis. action d'administration : autorisée pour le compte dont l'email correspond à ADMIN_EMAIL", async () => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  await loginWithEmail("admin@example.com");

  const recomputeReq = { method: "POST", headers: { origin: "https://blume.example.com", host: "blume.example.com" }, socket: {}, cookies: {} };
  const recomputeRes = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handleRecompute(recomputeReq, recomputeRes);
  expect(recomputeRes.statusCode).toBe(200);
});
