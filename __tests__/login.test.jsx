/**
 * @jest-environment jsdom
 *
 * L'erreur la plus trompeuse de Supabase Auth : un compte fraîchement créé dont
 * l'email n'est pas encore confirmé ne peut pas se connecter, et l'erreur brute
 * renvoyée peut donner l'impression, à tort, que c'est le mot de passe qui est
 * refusé. La page doit traduire cette erreur clairement et proposer de renvoyer
 * l'email de confirmation. Elle doit aussi offrir deux actions bien distinctes
 * (se connecter / créer un compte) et un formulaire d'inscription complet
 * (email, mot de passe, confirmation du mot de passe).
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Login from "../pages/login";

const replaceMock = jest.fn();
const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

const signInWithPassword = jest.fn();
const signUp = jest.fn();
const resend = jest.fn();

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      signInWithPassword: (...args) => signInWithPassword(...args),
      signUp: (...args) => signUp(...args),
      resend: (...args) => resend(...args),
    },
  },
}));

function submitButton(container) {
  return within(container.querySelector("form")).getByRole("button", { name: /se connecter|créer le compte/i });
}

beforeEach(() => {
  signInWithPassword.mockReset();
  signUp.mockReset().mockResolvedValue({ error: null });
  resend.mockReset();
  replaceMock.mockClear();
  pushMock.mockClear();
});

test("les deux actions (se connecter / créer un compte) sont toujours visibles et distinctes, sans dépendre d'un lien caché", () => {
  render(<Login />);
  // En mode connexion : l'onglet "Créer un compte" est présent et cliquable en plus
  // du bouton d'action "Se connecter" (qui, dans ce mode, porte le même intitulé que
  // l'onglet "Se connecter" — d'où les deux occurrences).
  expect(screen.getAllByRole("button", { name: "Se connecter" })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Créer un compte" })).toBeInTheDocument();
});

test("un email non confirmé affiche un message clair (pas juste \"mot de passe refusé\") et propose de renvoyer l'email", async () => {
  signInWithPassword.mockResolvedValue({ error: { code: "email_not_confirmed", message: "Email not confirmed" } });
  resend.mockResolvedValue({ error: null });

  const { container } = render(<Login />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(submitButton(container));

  await screen.findByText(/n'est pas encore confirmée/i);
  expect(screen.queryByText(/email not confirmed/i)).not.toBeInTheDocument();

  const resendBtn = screen.getByRole("button", { name: /renvoyer l'email de confirmation/i });
  fireEvent.click(resendBtn);

  await screen.findByText(/renvoyé/i);
  expect(resend).toHaveBeenCalledWith({ type: "signup", email: "test@example.com" });
});

test("des identifiants invalides affichent un message clair en français", async () => {
  signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });

  const { container } = render(<Login />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(submitButton(container));

  await screen.findByText(/email ou mot de passe incorrect/i);
  expect(screen.queryByRole("button", { name: /renvoyer l'email de confirmation/i })).not.toBeInTheDocument();
});

test("une connexion réussie redirige vers l'application (email normalisé : espaces retirés, minuscules)", async () => {
  signInWithPassword.mockResolvedValue({ error: null });

  const { container } = render(<Login />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "  Test@Example.com  " } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(submitButton(container));

  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  expect(signInWithPassword).toHaveBeenCalledWith({ email: "test@example.com", password: "motdepasse123" });
});

test("créer un compte : le formulaire demande la confirmation du mot de passe, et refuse si elles ne correspondent pas", async () => {
  const { container } = render(<Login />);
  fireEvent.click(screen.getByRole("button", { name: "Créer un compte" }));

  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.change(screen.getByPlaceholderText("Confirmer le mot de passe"), { target: { value: "autrechose1" } });
  fireEvent.click(submitButton(container));

  await screen.findByText(/ne correspondent pas/i);
  expect(signUp).not.toHaveBeenCalled();
});

test("créer un compte : ça fonctionne quand les deux mots de passe correspondent", async () => {
  const { container } = render(<Login />);
  fireEvent.click(screen.getByRole("button", { name: "Créer un compte" }));

  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.change(screen.getByPlaceholderText("Confirmer le mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(submitButton(container));

  await screen.findByText(/compte créé/i);
  expect(signUp).toHaveBeenCalledWith({ email: "test@example.com", password: "motdepasse123" });
});

test("une erreur de configuration (\"Invalid path specified\") est traduite en français, pas affichée telle quelle", async () => {
  signInWithPassword.mockResolvedValue({ error: { message: "Invalid path specified in request URL" } });

  const { container } = render(<Login />);
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: "motdepasse123" } });
  fireEvent.click(submitButton(container));

  await screen.findByText(/erreur de configuration/i);
  expect(screen.queryByText(/invalid path specified/i)).not.toBeInTheDocument();
});
