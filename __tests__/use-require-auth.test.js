/**
 * @jest-environment jsdom
 *
 * Bloc 3 : lib/useRequireAuth.js redirige vers /connexion dès qu'une personne non
 * connectée est confirmée — la première page vue par un visiteur anonyme doit être
 * la page de connexion, plus jamais le reste du site accessible sans compte.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useRequireAuth } from "../lib/useRequireAuth";

const replaceMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

let mockSession = null;
const onAuthStateChangeMock = jest.fn(() => ({ data: { subscription: { unsubscribe() {} } } }));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      onAuthStateChange: (...args) => onAuthStateChangeMock(...args),
    },
  },
}));

beforeEach(() => {
  replaceMock.mockClear();
  onAuthStateChangeMock.mockClear();
  window.history.replaceState(null, "", "/");
});

test("aucune session : redirige vers /connexion, authorized reste faux", async () => {
  mockSession = null;
  const { result } = renderHook(() => useRequireAuth());

  await waitFor(() => expect(result.current.sessionChecked).toBe(true));
  expect(result.current.authorized).toBe(false);
  expect(replaceMock).toHaveBeenCalledWith("/connexion");
});

test("une vraie session : aucune redirection, authorized devient vrai", async () => {
  mockSession = { user: { email: "test@example.com" } };
  const { result } = renderHook(() => useRequireAuth());

  await waitFor(() => expect(result.current.sessionChecked).toBe(true));
  expect(result.current.authorized).toBe(true);
  expect(replaceMock).not.toHaveBeenCalled();
});

test("avant que la vérification soit terminée : ni redirection ni accès autorisé", () => {
  mockSession = { user: { email: "test@example.com" } };
  const { result } = renderHook(() => useRequireAuth());

  expect(result.current.sessionChecked).toBe(false);
  expect(result.current.authorized).toBe(false);
  expect(replaceMock).not.toHaveBeenCalled();
});

// Bug corrigé : "Continuer avec Google" (pages/connexion.js) redirige vers "/" après
// Google — si ça échoue en chemin (provider pas encore activé côté Supabase, etc.),
// Supabase renvoie quand même vers "/" mais avec l'erreur dans l'URL au lieu d'une
// session. Sans ceci, la personne atterrissait sur cette page protégée, vide (aucune
// session), avec un message d'erreur brut resté dans l'URL sans jamais être affiché
// nulle part — d'où l'impression d'un "écran vide avec une erreur".
describe("échec de connexion Google détecté dans l'URL au retour", () => {
  test("\"?error=...&error_description=...\" dans l'URL : redirige vers /connexion avec l'erreur, pas juste /connexion", async () => {
    mockSession = null;
    window.history.replaceState(null, "", "/?error=access_denied&error_description=User+denied+access");
    const { result } = renderHook(() => useRequireAuth());

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
    expect(replaceMock).toHaveBeenCalledWith(
      "/connexion?authError=access_denied&authErrorDescription=User%20denied%20access"
    );
  });

  test("erreur dans le FRAGMENT (#error=...) de l'URL : détectée de la même façon", async () => {
    mockSession = null;
    window.history.replaceState(null, "", "/#error=server_error&error_description=oups");
    const { result } = renderHook(() => useRequireAuth());

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
    expect(replaceMock).toHaveBeenCalledWith(
      "/connexion?authError=server_error&authErrorDescription=oups"
    );
  });

  test("aucune erreur dans l'URL : redirige vers /connexion tout simplement (comportement inchangé)", async () => {
    mockSession = null;
    window.history.replaceState(null, "", "/");
    const { result } = renderHook(() => useRequireAuth());

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
    expect(replaceMock).toHaveBeenCalledWith("/connexion");
  });
});
