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
