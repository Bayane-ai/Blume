/**
 * @jest-environment jsdom
 *
 * Écran d'authentification UNIQUE "/connexion" — uniquement l'email intégré à
 * Supabase (Google complètement abandonné, aucun bouton pour ça) : un seul champ
 * (email), un seul bouton (Continuer), puis un code à 6 chiffres reçu par email
 * (jamais de lien magique, jamais de mot de passe). Le compte est créé
 * automatiquement au premier passage sur un email.
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Connexion from "../pages/connexion";

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const signInWithOtp = jest.fn();
const verifyOtp = jest.fn();
const getSession = jest.fn();

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: (...args) => getSession(...args),
      signInWithOtp: (...args) => signInWithOtp(...args),
      verifyOtp: (...args) => verifyOtp(...args),
    },
  },
}));

beforeEach(() => {
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: null } });
  pushMock.mockClear();
  replaceMock.mockClear();
});

test('affiche un seul champ "Entre ton email" et un seul bouton "Continuer" — jamais de mot de passe ni de bouton Google', () => {
  render(<Connexion />);
  expect(screen.getByPlaceholderText("Entre ton email")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continuer" })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/mot de passe/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
});

test("déjà connecté : redirection immédiate vers l'accueil, sans afficher le formulaire", async () => {
  getSession.mockResolvedValue({ data: { session: { user: { email: "test@example.com" } } } });
  render(<Connexion />);
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
});

test("email invalide : message clair, jamais d'appel à Supabase", async () => {
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "pas-un-email" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

  await screen.findByText(/adresse email invalide/i);
  expect(signInWithOtp).not.toHaveBeenCalled();
});

test("email valide : envoie le code (shouldCreateUser: true) et passe à l'étape code avec le message attendu", async () => {
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "  Test@Example.com  " } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

  await waitFor(() => expect(signInWithOtp).toHaveBeenCalledWith({
    email: "test@example.com",
    options: { shouldCreateUser: true },
  }));
  expect(await screen.findByPlaceholderText("Code à 6 chiffres")).toBeInTheDocument();
  expect(screen.getByText(/test@example\.com/)).toBeInTheDocument();
  expect(screen.getByText("Un code vient de t'être envoyé à ton adresse.")).toBeInTheDocument();
});

test("code non numérique ou incomplet : jamais accepté dans le champ", async () => {
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  const codeInput = await screen.findByPlaceholderText("Code à 6 chiffres");

  fireEvent.change(codeInput, { target: { value: "12a34b56" } });
  expect(codeInput).toHaveValue("123456");
});

test("code correct : appelle verifyOtp puis redirige vers l'accueil", async () => {
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  const codeInput = await screen.findByPlaceholderText("Code à 6 chiffres");
  fireEvent.change(codeInput, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: /valider le code/i }));

  await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ email: "test@example.com", token: "123456", type: "email" }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
});

test("code faux ou expiré : message exact \"Code incorrect ou expiré.\", pas de redirection", async () => {
  verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "Token has expired or is invalid" } });
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  const codeInput = await screen.findByPlaceholderText("Code à 6 chiffres");
  fireEvent.change(codeInput, { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: /valider le code/i }));

  expect(await screen.findByText("Code incorrect ou expiré.")).toBeInTheDocument();
  expect(pushMock).not.toHaveBeenCalled();
});

test('"Changer d\'email" revient à l\'étape email', async () => {
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  await screen.findByPlaceholderText("Code à 6 chiffres");

  fireEvent.click(screen.getByRole("button", { name: /changer d'email/i }));
  expect(screen.getByPlaceholderText("Entre ton email")).toBeInTheDocument();
});

// "un lien « Renvoyer le code » disponible après 30 secondes" (voir PROMPT) : pas de
// bouton actif tout de suite, un compte à rebours visible, puis un vrai bouton actif.
describe('"Renvoyer le code" — disponible après 30 secondes seulement', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("juste après l'envoi : pas de bouton actif, un compte à rebours affiché", async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    });
    await screen.findByPlaceholderText("Code à 6 chiffres");

    expect(screen.queryByRole("button", { name: /renvoyer le code/i })).not.toBeInTheDocument();
    expect(screen.getByText(/renvoyer le code \(dans 30s\)/i)).toBeInTheDocument();
  });

  test("après 30 secondes : le bouton devient actif et renvoie un nouveau code", async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    });
    await screen.findByPlaceholderText("Code à 6 chiffres");

    act(() => {
      jest.advanceTimersByTime(30000);
    });
    expect(screen.queryByText(/renvoyer le code \(dans/i)).not.toBeInTheDocument();
    const resendBtn = screen.getByRole("button", { name: /renvoyer le code/i });

    signInWithOtp.mockClear();
    await act(async () => {
      fireEvent.click(resendBtn);
    });
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
    // Le compte à rebours redémarre après un renvoi.
    expect(screen.getByText(/renvoyer le code \(dans 30s\)/i)).toBeInTheDocument();
  });

  test("à 15 secondes restantes : toujours pas de bouton actif", async () => {
    render(<Connexion />);
    fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    });
    await screen.findByPlaceholderText("Code à 6 chiffres");

    act(() => {
      jest.advanceTimersByTime(15000);
    });
    expect(screen.queryByRole("button", { name: /renvoyer le code/i })).not.toBeInTheDocument();
    expect(screen.getByText(/renvoyer le code \(dans 15s\)/i)).toBeInTheDocument();
  });
});

test("erreur de configuration (\"Invalid path specified\") traduite en français", async () => {
  signInWithOtp.mockResolvedValue({ error: { message: "Invalid path specified in request URL" } });
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

  await screen.findByText(/erreur de configuration/i);
  expect(screen.queryByText(/invalid path specified/i)).not.toBeInTheDocument();
});
