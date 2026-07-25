/**
 * @jest-environment jsdom
 *
 * Bloc 3 : page de connexion "/connexion" — email, mot de passe, bouton "Se
 * connecter", identifiants faux -> message clair, connexion réussie -> redirection
 * vers l'accueil, lien vers /inscription, "Mot de passe oublié" envoie l'email de
 * réinitialisation Supabase.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Connexion from "../pages/connexion";

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const signInWithPassword = jest.fn();
const resetPasswordForEmail = jest.fn();
const getSession = jest.fn();

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: (...args) => getSession(...args),
      signInWithPassword: (...args) => signInWithPassword(...args),
      resetPasswordForEmail: (...args) => resetPasswordForEmail(...args),
    },
  },
}));

beforeEach(() => {
  signInWithPassword.mockReset();
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: null } });
  pushMock.mockClear();
  replaceMock.mockClear();
});

test("affiche email, mot de passe et le bouton \"Se connecter\"", () => {
  render(<Connexion />);
  expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Mot de passe")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Se connecter" })).toBeInTheDocument();
});

test('lien "Pas encore de compte ? Créer un compte" vers /inscription', () => {
  render(<Connexion />);
  const link = screen.getByRole("link", { name: /créer un compte/i });
  expect(link).toHaveAttribute("href", "/inscription");
});

test("déjà connecté : redirection immédiate vers l'accueil, sans afficher le formulaire", async () => {
  getSession.mockResolvedValue({ data: { session: { user: { email: "test@example.com" } } } });
  render(<Connexion />);
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
});

test("identifiants faux : message d'erreur clair, pas de redirection", async () => {
  signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });

  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "mauvaismdp" } });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

  await screen.findByText(/email ou mot de passe incorrect/i);
  expect(pushMock).not.toHaveBeenCalled();
});

test("connexion réussie : redirige vers l'accueil (email normalisé)", async () => {
  signInWithPassword.mockResolvedValue({ error: null });

  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "  Test@Example.com  " } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  expect(signInWithPassword).toHaveBeenCalledWith({ email: "test@example.com", password: "motdepasse123" });
});

test('"Mot de passe oublié" sans email renseigné : message clair, pas d\'appel Supabase', async () => {
  render(<Connexion />);
  fireEvent.click(screen.getByRole("button", { name: /mot de passe oublié/i }));

  await screen.findByText(/renseigne d'abord ton adresse email/i);
  expect(resetPasswordForEmail).not.toHaveBeenCalled();
});

test('"Mot de passe oublié" avec un email renseigné : envoie l\'email de réinitialisation Supabase', async () => {
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "Test@Example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /mot de passe oublié/i }));

  await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledWith("test@example.com"));
  await screen.findByText(/email de réinitialisation envoyé/i);
});

test("erreur de configuration (\"Invalid path specified\") traduite en français", async () => {
  signInWithPassword.mockResolvedValue({ error: { message: "Invalid path specified in request URL" } });

  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

  await screen.findByText(/erreur de configuration/i);
  expect(screen.queryByText(/invalid path specified/i)).not.toBeInTheDocument();
});
