/**
 * @jest-environment jsdom
 *
 * Écran d'authentification UNIQUE "/connexion" — plus de mot de passe, plus de
 * distinction inscription/connexion : bouton "Continuer avec Google" (option
 * principale) ou email + code à 6 chiffres reçu par email. Le compte est créé
 * automatiquement au premier passage sur un email, dans les deux cas.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Connexion from "../pages/connexion";

const pushMock = jest.fn();
const replaceMock = jest.fn();
let mockIsReady = false;
let mockQuery = {};
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, isReady: mockIsReady, query: mockQuery }),
}));

const signInWithOAuth = jest.fn();
const signInWithOtp = jest.fn();
const verifyOtp = jest.fn();
const getSession = jest.fn();

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: (...args) => getSession(...args),
      signInWithOAuth: (...args) => signInWithOAuth(...args),
      signInWithOtp: (...args) => signInWithOtp(...args),
      verifyOtp: (...args) => verifyOtp(...args),
    },
  },
}));

beforeEach(() => {
  signInWithOAuth.mockReset().mockResolvedValue({ error: null });
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: null } });
  pushMock.mockClear();
  replaceMock.mockClear();
  mockIsReady = false;
  mockQuery = {};
});

test('affiche le bouton "Continuer avec Google" et le champ email, jamais de mot de passe', () => {
  render(<Connexion />);
  expect(screen.getByRole("button", { name: /continuer avec google/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Ton email")).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/mot de passe/i)).not.toBeInTheDocument();
});

test("déjà connecté : redirection immédiate vers l'accueil, sans afficher le formulaire", async () => {
  getSession.mockResolvedValue({ data: { session: { user: { email: "test@example.com" } } } });
  render(<Connexion />);
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
});

describe("Continuer avec Google", () => {
  test("appelle signInWithOAuth(provider: google) avec une redirection vers l'accueil", async () => {
    render(<Connexion />);
    fireEvent.click(screen.getByRole("button", { name: /continuer avec google/i }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const call = signInWithOAuth.mock.calls[0][0];
    expect(call.provider).toBe("google");
    expect(call.options.redirectTo).toMatch(/\/$/);
  });

  test("échec du démarrage de la connexion Google : message clair", async () => {
    signInWithOAuth.mockResolvedValue({ error: { code: "provider_disabled", message: "Provider disabled" } });
    render(<Connexion />);
    fireEvent.click(screen.getByRole("button", { name: /continuer avec google/i }));

    await screen.findByText(/momentanément indisponible/i);
  });
});

// Bug corrigé : quand "Continuer avec Google" échoue APRÈS le départ vers Google
// (provider pas encore activé côté Supabase, redirect URI non autorisée, personne qui
// annule sur l'écran Google...), Supabase renvoie vers "/" avec l'erreur dans l'URL —
// lib/useRequireAuth.js détecte ce cas (voir __tests__/use-require-auth.test.js) et
// redirige ici avec "?authError=...&authErrorDescription=..." : cette page doit
// l'afficher clairement plutôt que de laisser la personne sur un écran qui semble
// vide.
describe("échec de connexion Google détecté au retour (?authError=...)", () => {
  test("affiche un message clair traduit et nettoie l'URL", async () => {
    mockIsReady = true;
    mockQuery = { authError: "access_denied", authErrorDescription: "User denied access" };
    render(<Connexion />);

    await screen.findByText(/connexion annulée/i);
    expect(replaceMock).toHaveBeenCalledWith("/connexion", undefined, { shallow: true });
  });

  test("aucune erreur dans l'URL : rien ne s'affiche, aucun nettoyage inutile", () => {
    mockIsReady = true;
    mockQuery = {};
    render(<Connexion />);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("Email + code à 6 chiffres", () => {
  test("email invalide : message clair, jamais d'appel à Supabase", async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: "pas-un-email" } });
    fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));

    await screen.findByText(/adresse email invalide/i);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  test("email valide : envoie le code (shouldCreateUser: true) et passe à l'étape code", async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: "  Test@Example.com  " } });
    fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledWith({
      email: "test@example.com",
      options: { shouldCreateUser: true },
    }));
    expect(await screen.findByPlaceholderText("Code à 6 chiffres")).toBeInTheDocument();
    expect(screen.getByText(/test@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/valable 10 minutes/i)).toBeInTheDocument();
  });

  test("code non numérique ou incomplet : jamais accepté dans le champ", async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: "test@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));
    const codeInput = await screen.findByPlaceholderText("Code à 6 chiffres");

    fireEvent.change(codeInput, { target: { value: "12a34b56" } });
    expect(codeInput).toHaveValue("123456");
  });

  test("code correct : appelle verifyOtp puis redirige vers l'accueil", async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: "test@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));
    const codeInput = await screen.findByPlaceholderText("Code à 6 chiffres");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /valider le code/i }));

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ email: "test@example.com", token: "123456", type: "email" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  });

  test("code faux ou expiré : message clair, pas de redirection", async () => {
    verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "Token has expired or is invalid" } });
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: "test@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));
    const codeInput = await screen.findByPlaceholderText("Code à 6 chiffres");
    fireEvent.change(codeInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /valider le code/i }));

    await screen.findByText(/invalide ou a expiré/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  test('"Changer d\'email" revient à l\'étape email', async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: "test@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));
    await screen.findByPlaceholderText("Code à 6 chiffres");

    fireEvent.click(screen.getByRole("button", { name: /changer d'email/i }));
    expect(screen.getByPlaceholderText("Ton email")).toBeInTheDocument();
  });

  test('"Renvoyer le code" appelle de nouveau signInWithOtp', async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: "test@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));
    await screen.findByPlaceholderText("Code à 6 chiffres");
    signInWithOtp.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /renvoyer le code/i }));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
  });
});

test("erreur de configuration (\"Invalid path specified\") traduite en français", async () => {
  signInWithOtp.mockResolvedValue({ error: { message: "Invalid path specified in request URL" } });
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Ton email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /recevoir un code/i }));

  await screen.findByText(/erreur de configuration/i);
  expect(screen.queryByText(/invalid path specified/i)).not.toBeInTheDocument();
});
