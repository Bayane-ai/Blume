/**
 * @jest-environment jsdom
 *
 * Bloc 3 : lib/useRequireAuth.js redirige vers /connexion dès qu'une personne non
 * connectée est confirmée — la première page vue par un visiteur anonyme doit être
 * la page de connexion, plus jamais le reste du site accessible sans compte. Le
 * cookie de session est httpOnly (voir lib/session.js) : ce hook demande la session
 * au serveur via GET /api/auth/session, plutôt que d'appeler un SDK d'authentification
 * côté client (il n'y en a plus, Supabase Auth a été entièrement abandonné).
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useRequireAuth } from "../lib/useRequireAuth";

const replaceMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

let mockSession = null;

beforeEach(() => {
  replaceMock.mockClear();
  global.fetch = jest.fn((url) => {
    if (url === "/api/auth/session") return Promise.resolve({ json: () => Promise.resolve({ session: mockSession }) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
});

test("aucune session : redirige vers /connexion, authorized reste faux", async () => {
  mockSession = null;
  const { result } = renderHook(() => useRequireAuth());

  await waitFor(() => expect(result.current.sessionChecked).toBe(true));
  expect(result.current.authorized).toBe(false);
  expect(replaceMock).toHaveBeenCalledWith("/connexion");
});

test("une vraie session : aucune redirection, authorized devient vrai", async () => {
  mockSession = { id: "user-1", email: "test@example.com" };
  const { result } = renderHook(() => useRequireAuth());

  await waitFor(() => expect(result.current.sessionChecked).toBe(true));
  expect(result.current.authorized).toBe(true);
  expect(replaceMock).not.toHaveBeenCalled();
});

test("avant que la vérification soit terminée : ni redirection ni accès autorisé", () => {
  mockSession = { id: "user-1", email: "test@example.com" };
  const { result } = renderHook(() => useRequireAuth());

  expect(result.current.sessionChecked).toBe(false);
  expect(result.current.authorized).toBe(false);
  expect(replaceMock).not.toHaveBeenCalled();
});

test("échec réseau de /api/auth/session : traité comme non connecté, jamais un plantage", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("network down")));
  const { result } = renderHook(() => useRequireAuth());

  await waitFor(() => expect(result.current.sessionChecked).toBe(true));
  expect(result.current.authorized).toBe(false);
  expect(replaceMock).toHaveBeenCalledWith("/connexion");
});
