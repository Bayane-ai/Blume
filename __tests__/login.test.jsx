/**
 * @jest-environment jsdom
 *
 * L'erreur la plus trompeuse de Supabase Auth : un compte fraîchement créé dont
 * l'email n'est pas encore confirmé ne peut pas se connecter, et l'erreur brute
 * renvoyée peut donner l'impression, à tort, que c'est le mot de passe qui est
 * refusé. La page doit traduire cette erreur clairement et proposer de renvoyer
 * l'email de confirmation.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Login from "../pages/login";

const replaceMock = jest.fn();
const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

const signInWithPassword = jest.fn();
const resend = jest.fn();

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      signInWithPassword: (...args) => signInWithPassword(...args),
      signUp: jest.fn(() => Promise.resolve({ error: null })),
      resend: (...args) => resend(...args),
    },
  },
}));

beforeEach(() => {
  signInWithPassword.mockReset();
  resend.mockReset();
  replaceMock.mockClear();
  pushMock.mockClear();
});

test("un email non confirmé affiche un message clair (pas juste \"mot de passe refusé\") et propose de renvoyer l'email", async () => {
  signInWithPassword.mockResolvedValue({ error: { code: "email_not_confirmed", message: "Email not confirmed" } });
  resend.mockResolvedValue({ error: null });

  render(<Login />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(screen.getByRole("button", { name: /se connecter/i }));

  await screen.findByText(/n'est pas encore confirmée/i);
  expect(screen.queryByText(/email not confirmed/i)).not.toBeInTheDocument();

  const resendBtn = screen.getByRole("button", { name: /renvoyer l'email de confirmation/i });
  fireEvent.click(resendBtn);

  await screen.findByText(/renvoyé/i);
  expect(resend).toHaveBeenCalledWith({ type: "signup", email: "test@example.com" });
});

test("des identifiants invalides affichent un message clair en français", async () => {
  signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });

  render(<Login />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(screen.getByRole("button", { name: /se connecter/i }));

  await screen.findByText(/email ou mot de passe incorrect/i);
  expect(screen.queryByRole("button", { name: /renvoyer l'email de confirmation/i })).not.toBeInTheDocument();
});

test("une connexion réussie redirige vers l'application", async () => {
  signInWithPassword.mockResolvedValue({ error: null });

  render(<Login />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(screen.getByRole("button", { name: /se connecter/i }));

  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
});
