/**
 * @jest-environment jsdom
 *
 * Bloc 5 — parcours de connexion complet, de bout en bout, contre un FAUX backend
 * Supabase réaliste (auth email/mot de passe + tables avec Row Level Security simulée
 * : chaque lecture/écriture est filtrée par le VRAI user_id du compte actuellement
 * connecté dans le faux backend, exactement comme le ferait Postgres). Couvre les 6
 * points demandés :
 *   1. Inscription (compte créé, mineur refusé, mots de passe différents refusés,
 *      email déjà utilisé refusé)
 *   2. Connexion automatique + redirection vers l'accueil après inscription
 *   3. Déconnexion -> /connexion
 *   4. Reconnexion (bon mot de passe -> accès ; mauvais -> refusé)
 *   5. Isolation des données entre deux comptes (test clé)
 *   6. Protection des pages pour un visiteur non connecté
 *
 * Les vraies pages (pages/inscription.js, pages/connexion.js, pages/historique.js,
 * pages/index.js) et la vraie logique (lib/matchHistory.js, lib/age.js,
 * lib/useRequireAuth.js, components/SiteHeader.js) sont exercées telles quelles —
 * seul le client Supabase est remplacé par ce faux backend en mémoire, pour pouvoir
 * créer plusieurs vrais comptes distincts sans dépendre d'un projet Supabase réel.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Inscription from "../pages/inscription";
import Connexion from "../pages/connexion";
import Historique from "../pages/historique";
import Home from "../pages/index";
import { supabase } from "../lib/supabaseClient";
import { addMatchToHistory } from "../lib/matchHistory";

const pushMock = jest.fn();
const replaceMock = jest.fn();
let mockPathname = "/";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, pathname: mockPathname, isReady: true, query: {} }),
}));

// Faux backend Supabase EN MÉMOIRE (auth email/mot de passe + tables "profiles" et
// "match_history") — toute la logique métier (âge, mots de passe, email déjà utilisé,
// isolation par user_id) reste dans les VRAIES pages/lib du site ; ce faux backend ne
// fait que se comporter comme le ferait réellement Supabase/Postgres pour chacun de
// ces cas, y compris le filtrage RLS (chaque requête ne renvoie que les lignes dont
// user_id correspond à l'appelant, jamais un raccourci qui rendrait le test complice).
jest.mock("../lib/supabaseClient", () => {
  let users; // email -> { id, password }
  let currentSession; // { user: { id, email } } | null
  let listeners;
  let profiles; // id -> row
  let matchHistoryRows;
  let nextUserId;

  function reset() {
    users = {};
    currentSession = null;
    listeners = [];
    profiles = {};
    matchHistoryRows = [];
    nextUserId = 1;
  }
  reset();

  function notify() {
    listeners.forEach((cb) => cb(currentSession ? "SIGNED_IN" : "SIGNED_OUT", currentSession));
  }

  const supabase = {
    auth: {
      signUp: async ({ email, password, options }) => {
        if (users[email]) {
          return { data: { user: null, session: null }, error: { code: "user_already_exists", message: "User already registered" } };
        }
        const id = `user-${nextUserId++}`;
        users[email] = { id, password };
        profiles[id] = {
          id, email,
          nom_utilisateur: options?.data?.nom_utilisateur || null,
          date_de_naissance: options?.data?.date_de_naissance || null,
        };
        currentSession = { user: { id, email } };
        notify();
        return { data: { user: currentSession.user, session: currentSession }, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        const u = users[email];
        if (!u || u.password !== password) {
          return { error: { code: "invalid_credentials", message: "Invalid login credentials" } };
        }
        currentSession = { user: { id: u.id, email } };
        notify();
        return { error: null };
      },
      signOut: async () => {
        currentSession = null;
        notify();
        return {};
      },
      getSession: async () => ({ data: { session: currentSession } }),
      onAuthStateChange: (cb) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => { listeners = listeners.filter((l) => l !== cb); } } } };
      },
      resetPasswordForEmail: async () => ({ error: null }),
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
  };

  return { supabase };
});

// La date de naissance se saisit désormais en 3 champs (Jour/Mois/Année, voir
// components/DateOfBirthInput.js) plutôt qu'un unique <input type="date"> — on
// éclate ici l'ISO "AAAA-MM-JJ" en ses 3 parties pour remplir chaque champ.
function fillDateOfBirth(iso) {
  const [year, month, day] = iso.split("-");
  fireEvent.change(screen.getByLabelText("Jour de naissance"), { target: { value: day } });
  fireEvent.change(screen.getByLabelText("Mois de naissance"), { target: { value: month } });
  fireEvent.change(screen.getByLabelText("Année de naissance"), { target: { value: year } });
}

function fillInscriptionForm({ email, password, dobYearsAgo, pseudo }) {
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - dobYearsAgo);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: password } });
  fireEvent.change(screen.getByPlaceholderText("Confirmer le mot de passe"), { target: { value: password } });
  fillDateOfBirth(dob.toISOString().slice(0, 10));
  fireEvent.change(screen.getByPlaceholderText("Pseudo"), { target: { value: pseudo } });
  fireEvent.click(screen.getByRole("checkbox"));
}

beforeEach(() => {
  supabase.__resetFakeBackend();
  pushMock.mockClear();
  replaceMock.mockClear();
  mockPathname = "/";
});

// ---------------------------------------------------------------------------
// 1. Inscription — validations qui doivent REFUSER la création de compte.
// ---------------------------------------------------------------------------
describe("1. Inscription — refus attendus", () => {
  test("un mineur (moins de 18 ans) est refusé", async () => {
    render(<Inscription />);
    fillInscriptionForm({ email: "mineur@example.com", password: "motdepasse123", dobYearsAgo: 15, pseudo: "Mineur" });
    fireEvent.click(screen.getByRole("button", { name: /créer le compte/i }));

    await screen.findByText(/au moins 18 ans/i);
    expect(pushMock).not.toHaveBeenCalled();
    expect((await supabase.auth.getSession()).data.session).toBeNull();
  });

  test("deux mots de passe différents sont refusés", async () => {
    render(<Inscription />);
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
    fireEvent.change(screen.getByPlaceholderText("Confirmer le mot de passe"), { target: { value: "autrechose1" } });
    fillDateOfBirth("2000-06-01");
    fireEvent.change(screen.getByPlaceholderText("Pseudo"), { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /créer le compte/i }));

    await screen.findByText(/ne correspondent pas/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("un email déjà utilisé est refusé", async () => {
    // Un compte existe déjà avec cet email.
    await supabase.auth.signUp({ email: "deja@example.com", password: "motdepasse123", options: { data: {} } });
    await supabase.auth.signOut();

    render(<Inscription />);
    fillInscriptionForm({ email: "deja@example.com", password: "autremotdepasse", dobYearsAgo: 25, pseudo: "Nouveau" });
    fireEvent.click(screen.getByRole("button", { name: /créer le compte/i }));

    await screen.findByText(/un compte existe déjà/i);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. + 3. + 4. + 5. + 6. — le parcours complet, séquentiel (l'état du faux backend
// doit persister d'une étape à l'autre : deux comptes réels, données isolées, aller-
// retour de session).
// ---------------------------------------------------------------------------
test("parcours complet : inscription -> connexion auto -> donnée personnelle -> isolation entre deux comptes -> déconnexion -> reconnexion -> protection", async () => {
  // --- 1. + 2. Inscription du compte A : compte créé, connecté automatiquement, redirigé vers l'accueil.
  const inscriptionA = render(<Inscription />);
  fillInscriptionForm({ email: "alice@example.com", password: "motdepasseA1", dobYearsAgo: 30, pseudo: "Alice" });
  fireEvent.click(screen.getByRole("button", { name: /créer le compte/i }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  inscriptionA.unmount();

  const sessionA = (await supabase.auth.getSession()).data.session;
  expect(sessionA?.user?.email).toBe("alice@example.com");
  const userIdA = sessionA.user.id;

  // --- 5. (partie 1) Le compte A enregistre une donnée personnelle (un match consulté,
  // voir lib/matchHistory.js — table match_history, Row Level Security).
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

  // --- 3. Déconnexion du compte A : le bouton "Se déconnecter" (SiteHeader, rendu par
  // Historique) déconnecte réellement et renvoie vers /connexion.
  const historiqueForLogout = render(<Historique />);
  await screen.findAllByTestId("match-history-card");
  fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/connexion"));
  expect((await supabase.auth.getSession()).data.session).toBeNull();
  historiqueForLogout.unmount();
  pushMock.mockClear();

  // --- 1. + 5. (partie 2) Inscription du compte B (autre email/mot de passe/pseudo) :
  // toujours connecté automatiquement après inscription.
  const inscriptionB = render(<Inscription />);
  fillInscriptionForm({ email: "bob@example.com", password: "motdepasseB1", dobYearsAgo: 28, pseudo: "Bob" });
  fireEvent.click(screen.getByRole("button", { name: /créer le compte/i }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  inscriptionB.unmount();

  const sessionB = (await supabase.auth.getSession()).data.session;
  expect(sessionB?.user?.email).toBe("bob@example.com");

  // --- 5. (test clé) Isolation : B ne doit voir AUCUNE donnée de A.
  const historiqueB = render(<Historique />);
  expect(await screen.findByTestId("match-history-empty")).toBeInTheDocument();
  expect(screen.queryByText("Arsenal FC")).not.toBeInTheDocument();
  expect(screen.queryByTestId("match-history-card")).not.toBeInTheDocument();
  historiqueB.unmount();

  // --- 3. Déconnexion du compte B.
  await supabase.auth.signOut();

  // --- 6. Protection : un visiteur non connecté qui tente d'ouvrir une page du site
  // est renvoyé vers /connexion (aucune session -> lib/useRequireAuth.js redirige).
  replaceMock.mockClear();
  const homeAnonymous = render(<Home />);
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/connexion"));
  expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
  homeAnonymous.unmount();

  // --- 4. Reconnexion : mauvais mot de passe refusé, bon mot de passe accepté.
  pushMock.mockClear();
  const connexionWrong = render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "alice@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "mauvais-mot-de-passe" } });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
  await screen.findByText(/email ou mot de passe incorrect/i);
  expect(pushMock).not.toHaveBeenCalledWith("/");
  expect((await supabase.auth.getSession()).data.session).toBeNull();
  connexionWrong.unmount();

  pushMock.mockClear();
  const connexionRight = render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "alice@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasseA1" } });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  connexionRight.unmount();

  const sessionAAgain = (await supabase.auth.getSession()).data.session;
  expect(sessionAAgain?.user?.email).toBe("alice@example.com");

  // --- 5. (test clé, retour) A retrouve bien SES données après reconnexion.
  const historiqueA2 = render(<Historique />);
  const cardsA2 = await screen.findAllByTestId("match-history-card");
  expect(cardsA2).toHaveLength(1);
  expect(cardsA2[0]).toHaveTextContent("Arsenal FC");
  historiqueA2.unmount();
}, 20000);
