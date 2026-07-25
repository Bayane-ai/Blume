/**
 * @jest-environment jsdom
 *
 * Bloc 4, tâche 4 : "Ajoute en haut du site l'email de l'utilisateur connecté et un
 * bouton 'Se déconnecter' (qui renvoie vers /connexion)." La table "profiles" ne
 * stocke plus qu'un email (voir supabase/migrations/0008_custom_auth.sql) : plus de
 * pseudo, l'email est affiché directement. "Se déconnecter" appelle POST
 * /api/auth/logout (efface le cookie de session) PUIS redirige explicitement vers
 * /connexion.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SiteHeader from "../components/SiteHeader";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: pushMock }),
}));

const session = { id: "user-1", email: "test@example.com" };

beforeEach(() => {
  pushMock.mockClear();
  global.fetch = jest.fn((url) => {
    if (url === "/api/whoami") return Promise.resolve({ json: () => Promise.resolve({ isOwner: false }) });
    if (url === "/api/auth/logout") return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
});

test("affiche l'email du compte connecté", async () => {
  render(<SiteHeader session={session} />);
  expect(await screen.findByText("test@example.com")).toBeInTheDocument();
});

test("sans session : ni email ni bouton \"Se déconnecter\"", () => {
  render(<SiteHeader session={null} />);
  expect(screen.queryByRole("button", { name: /se déconnecter/i })).not.toBeInTheDocument();
});

test('"Se déconnecter" appelle POST /api/auth/logout puis redirige vers /connexion', async () => {
  render(<SiteHeader session={session} />);
  fireEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/connexion"));
});
