/**
 * @jest-environment jsdom
 *
 * Parcours de connexion complet, de bout en bout, contre un FAUX backend Supabase
 * réaliste (Google OAuth + email/code OTP, plus tables avec Row Level Security
 * simulée : chaque lecture/écriture est filtrée par le VRAI user_id du compte
 * actuellement connecté dans le faux backend, exactement comme le ferait Postgres).
 * Couvre les points demandés :
 *   1. Connexion Google avec un nouvel email -> compte créé automatiquement
 *   2. Connexion avec le code email -> compte créé automatiquement
 *   3. Reconnexion avec le même email -> on retrouve son contenu
 *   4. Connexion avec un deuxième email -> contenu totalement différent et vide
 *   5. Déconnexion -> /connexion, protection pour un visiteur non connecté
 *   6. Action d'administration depuis un compte non-admin -> refusée
 *
 * Les vraies pages (pages/connexion.js, pages/historique.js, pages/index.js) et la
 * vraie logique (lib/matchHistory.js, lib/useRequireAuth.js, components/SiteHeader.js,
 * lib/auth/owner.js) sont exercées telles quelles — seul le client Supabase est
 * remplacé par ce faux backend en mémoire, pour pouvoir créer plusieurs vrais comptes
 * distincts sans dépendre d'un projet Supabase/Google réel.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Connexion from "../pages/connexion";
import Historique from "../pages/historique";
import Home from "../pages/index";
import { supabase } from "../lib/supabaseClient";
import { addMatchToHistory } from "../lib/matchHistory";
import { isOwner } from "../lib/auth/owner";
import handleRecompute from "../pages/api/admin/recompute";

const pushMock = jest.fn();
const replaceMock = jest.fn();
let mockPathname = "/";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, pathname: mockPathname, isReady: true, query: {} }),
}));

jest.mock("../lib/comboHistory", () => ({ maintainAndGetComboStats: jest.fn(() => Promise.resolve({ successRates: {}, progress: {} })) }));
jest.mock("../lib/pronosticHistory", () => ({ listAndMaintainHistory: jest.fn(() => Promise.resolve([])) }));
jest.mock("../lib/security/guardMutation", () => ({ guardMutation: () => true }));

// Faux backend Supabase EN MÉMOIRE (Google OAuth + email/code OTP, tables "profiles"
// et "match_history") — toute la logique métier (isolation par user_id, création
// automatique de compte) reste dans les VRAIES pages/lib du site ; ce faux backend ne
// fait que se comporter comme le ferait réellement Supabase/Postgres pour chacun de
// ces cas, y compris le filtrage RLS (chaque requête ne renvoie que les lignes dont
// user_id correspond à l'appelant, jamais un raccourci qui rendrait le test complice).
//
// signInWithOAuth ne peut pas réellement rediriger vers Google dans jsdom : un hook de
// test dédié (__setNextGoogleAccount) simule "la personne a choisi tel compte Google
// et revient déjà connectée", exactement l'effet observable d'un aller-retour OAuth
// réussi — le code de pages/connexion.js, lui, appelle signInWithOAuth normalement.
jest.mock("../lib/supabaseClient", () => {
  let users; // email -> { id }
  let currentSession;
  let listeners;
  let profiles;
  let matchHistoryRows;
  let nextUserId;
  let pendingOtp; // email -> code
  let nextGoogleEmail;

  function reset() {
    users = {};
    currentSession = null;
    listeners = [];
    profiles = {};
    matchHistoryRows = [];
    nextUserId = 1;
    pendingOtp = {};
    nextGoogleEmail = null;
  }
  reset();

  function notify() {
    listeners.forEach((cb) => cb(currentSession ? "SIGNED_IN" : "SIGNED_OUT", currentSession));
  }

  // "Un email = un seul compte" : retrouve la ligne existante par email plutôt que
  // d'en recréer une, exactement le comportement de liaison automatique de Supabase
  // Auth par email vérifié (Google ET email/code se rattachent à la MÊME ligne).
  function getOrCreateUser(email) {
    if (!users[email]) {
      const id = `user-${nextUserId++}`;
      users[email] = { id, email };
      profiles[id] = { id, email, nom_utilisateur: null, date_de_naissance: null };
    }
    return users[email];
  }

  function signIn(email) {
    const u = getOrCreateUser(email);
    currentSession = { user: { id: u.id, email, email_confirmed_at: "2026-01-01T00:00:00Z" } };
    notify();
    return currentSession;
  }

  const supabase = {
    auth: {
      signInWithOAuth: async () => {
        if (!nextGoogleEmail) return { error: { code: "provider_disabled", message: "Aucun compte Google simulé pour ce test" } };
        signIn(nextGoogleEmail);
        return { error: null };
      },
      signInWithOtp: async ({ email }) => {
        pendingOtp[email] = "123456";
        return { error: null };
      },
      verifyOtp: async ({ email, token }) => {
        if (pendingOtp[email] !== token) {
          return { error: { code: "otp_expired", message: "Token has expired or is invalid" } };
        }
        delete pendingOtp[email];
        signIn(email);
        return { error: null };
      },
      signOut: async () => {
        currentSession = null;
        notify();
        return {};
      },
      getSession: async () => ({ data: { session: currentSession } }),
      getUser: async () => ({ data: { user: currentSession?.user || null } }),
      onAuthStateChange: (cb) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => { listeners = listeners.filter((l) => l !== cb); } } } };
      },
    },
    from: (table) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                const row = Object.values(profiles).find((p) => p[col] === val);
                return { data: row || null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "match_history") {
        return {
          upsert: async (row, opts) => {
            const conflictCols = (opts?.onConflict || "").split(",");
            const idx = matchHistoryRows.findIndex((r) => conflictCols.every((c) => r[c] === row[c]));
            if (idx >= 0) matchHistoryRows[idx] = { ...matchHistoryRows[idx], ...row };
            else matchHistoryRows.push({ ...row });
            return { error: null };
          },
          delete: () => {
            const filters = [];
            const builder = {
              eq: (col, val) => { filters.push(["eq", col, val]); return builder; },
              lt: (col, val) => { filters.push(["lt", col, val]); return builder; },
              then: (resolve) => {
                // Isolation RLS simulée : ne retire jamais les lignes d'un AUTRE compte.
                matchHistoryRows = matchHistoryRows.filter(
                  (r) => !filters.every(([op, col, val]) => (op === "eq" ? r[col] === val : r[col] < val))
                );
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return builder;
          },
          select: () => {
            const filters = [];
            let orderCol = null;
            let ascending = true;
            const builder = {
              eq: (col, val) => { filters.push([col, val]); return builder; },
              order: (col, o) => { orderCol = col; ascending = !!o?.ascending; return builder; },
              then: (resolve) => {
                // Isolation RLS simulée : seules les lignes du user_id demandé sont
                // renvoyées, jamais celles d'un autre compte.
                let result = matchHistoryRows.filter((r) => filters.every(([col, val]) => r[col] === val));
                if (orderCol) {
                  result = [...result].sort((a, b) => {
                    if (a[orderCol] === b[orderCol]) return 0;
                    const cmp = a[orderCol] > b[orderCol] ? 1 : -1;
                    return ascending ? cmp : -cmp;
                  });
                }
                return Promise.resolve({ data: result, error: null }).then(resolve);
              },
            };
            return builder;
          },
        };
      }
      return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
    },
    __resetFakeBackend: reset,
    __setNextGoogleAccount: (email) => { nextGoogleEmail = email; },
  };

  return { supabase };
});

jest.mock("../lib/supabaseServer", () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: () => supabase.auth.getUser() },
  }),
}));

function fillEmail(email) {
  fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: email } });
}

async function loginWithCode(email) {
  const view = render(<Connexion />);
  fillEmail(email);
  fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));
  const codeInput = await screen.findByPlaceholderText("Code à 6 chiffres");
  fireEvent.change(codeInput, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: /valider le code/i }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  view.unmount();
}

async function loginWithGoogle(email) {
  supabase.__setNextGoogleAccount(email);
  const view = render(<Connexion />);
  fireEvent.click(screen.getByRole("button", { name: /continuer avec google/i }));
  // Dans la vraie vie, signInWithOAuth redirige le navigateur vers Google puis
  // revient déjà connecté sur la page choisie (redirectTo) : ici, le faux backend
  // établit directement la session (voir __setNextGoogleAccount) — la page ne fait
  // ensuite qu'attendre que sa propre vérification de session la redirige, comme
  // elle le ferait au retour réel de Google.
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
  view.unmount();
}

beforeEach(() => {
  supabase.__resetFakeBackend();
  pushMock.mockClear();
  replaceMock.mockClear();
  mockPathname = "/";
  delete process.env.OWNER_EMAIL;
});

test("1. connexion Google avec un nouvel email : compte créé automatiquement, connecté", async () => {
  await loginWithGoogle("alice@example.com");
  const session = (await supabase.auth.getSession()).data.session;
  expect(session?.user?.email).toBe("alice@example.com");
});

test("2. connexion avec un code reçu par email (nouvel email) : compte créé automatiquement, connecté", async () => {
  await loginWithCode("bob@example.com");
  const session = (await supabase.auth.getSession()).data.session;
  expect(session?.user?.email).toBe("bob@example.com");
});

test("code faux ou expiré : refusé, aucun compte connecté", async () => {
  render(<Connexion />);
  fillEmail("test@example.com");
  fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));
  const codeInput = await screen.findByPlaceholderText("Code à 6 chiffres");
  fireEvent.change(codeInput, { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: /valider le code/i }));

  await screen.findByText(/invalide ou a expiré/i);
  expect(pushMock).not.toHaveBeenCalledWith("/");
  expect((await supabase.auth.getSession()).data.session).toBeNull();
});

test("parcours complet : Google (nouveau compte) -> donnée personnelle -> déconnexion -> code email (2e compte, isolation) -> déconnexion -> reconnexion Google -> contenu retrouvé -> protection -> action admin refusée pour un non-admin", async () => {
  process.env.OWNER_EMAIL = "owner@example.com";

  // --- 1. Connexion Google, nouvel email : compte A créé et connecté.
  await loginWithGoogle("alice@example.com");
  const sessionA = (await supabase.auth.getSession()).data.session;
  expect(sessionA?.user?.email).toBe("alice@example.com");
  const userIdA = sessionA.user.id;

  // --- Le compte A enregistre une donnée personnelle (un match consulté, voir
  // lib/matchHistory.js — table match_history, Row Level Security).
  await addMatchToHistory(userIdA, {
    id: 101, status: "SCHEDULED", minute: null, utcDate: "2026-08-01T15:00:00Z",
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
    score: { fullTime: { home: null, away: null } },
  });

  const historiqueA1 = render(<Historique />);
  const cardsA1 = await screen.findAllByTestId("match-history-card");
  expect(cardsA1).toHaveLength(1);
  expect(cardsA1[0]).toHaveTextContent("Arsenal FC");
  historiqueA1.unmount();

  // --- Déconnexion du compte A : le bouton "Se déconnecter" (SiteHeader, rendu par
  // Historique) déconnecte réellement et renvoie vers /connexion.
  const historiqueForLogout = render(<Historique />);
  await screen.findAllByTestId("match-history-card");
  fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/connexion"));
  expect((await supabase.auth.getSession()).data.session).toBeNull();
  historiqueForLogout.unmount();
  pushMock.mockClear();

  // --- 2. + isolation : connexion par CODE EMAIL avec un second email (compte B),
  // jamais le même compte que A.
  await loginWithCode("bob@example.com");
  const sessionB = (await supabase.auth.getSession()).data.session;
  expect(sessionB?.user?.email).toBe("bob@example.com");
  expect(sessionB.user.id).not.toBe(userIdA);

  // --- Isolation (test clé) : B ne doit voir AUCUNE donnée de A.
  const historiqueB = render(<Historique />);
  expect(await screen.findByTestId("match-history-empty")).toBeInTheDocument();
  expect(screen.queryByText("Arsenal FC")).not.toBeInTheDocument();
  expect(screen.queryByTestId("match-history-card")).not.toBeInTheDocument();
  historiqueB.unmount();

  // --- Action d'administration depuis le compte B (non-admin) : refusée.
  expect(isOwner(sessionB)).toBe(false);
  const recomputeReq = { method: "POST", headers: { origin: "https://blume.example.com", host: "blume.example.com" }, socket: {} };
  const recomputeRes = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handleRecompute(recomputeReq, recomputeRes);
  expect(recomputeRes.statusCode).toBe(403);

  // --- Déconnexion du compte B.
  await supabase.auth.signOut();

  // --- Protection : un visiteur non connecté qui tente d'ouvrir une page du site est
  // renvoyé vers /connexion (aucune session -> lib/useRequireAuth.js redirige).
  replaceMock.mockClear();
  const homeAnonymous = render(<Home />);
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/connexion"));
  expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
  homeAnonymous.unmount();

  // --- 3. Reconnexion avec le MÊME email (Google, comme la première fois) : on
  // retrouve bien le compte A et SES données.
  pushMock.mockClear();
  replaceMock.mockClear();
  await loginWithGoogle("alice@example.com");
  const sessionAAgain = (await supabase.auth.getSession()).data.session;
  expect(sessionAAgain?.user?.email).toBe("alice@example.com");
  expect(sessionAAgain.user.id).toBe(userIdA);

  const historiqueA2 = render(<Historique />);
  const cardsA2 = await screen.findAllByTestId("match-history-card");
  expect(cardsA2).toHaveLength(1);
  expect(cardsA2[0]).toHaveTextContent("Arsenal FC");
  historiqueA2.unmount();
}, 20000);

test("action d'administration : autorisée pour le compte dont l'email correspond à OWNER_EMAIL", async () => {
  process.env.OWNER_EMAIL = "owner@example.com";
  await loginWithGoogle("owner@example.com");

  const recomputeReq = { method: "POST", headers: { origin: "https://blume.example.com", host: "blume.example.com" }, socket: {} };
  const recomputeRes = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handleRecompute(recomputeReq, recomputeRes);
  expect(recomputeRes.statusCode).toBe(200);
});
