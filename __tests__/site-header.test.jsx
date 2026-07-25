/**
 * @jest-environment jsdom
 *
 * Bloc 4, tâche 4 : "Ajoute en haut du site le pseudo/email de l'utilisateur connecté
 * et un bouton 'Se déconnecter' (qui renvoie vers /connexion)." Le pseudo vient de la
 * table "profiles" (Row Level Security : un compte ne lit que sa propre ligne, voir
 * supabase/migrations/0005_profiles.sql) ; à défaut de pseudo renseigné, l'email reste
 * affiché. "Se déconnecter" appelle signOut() PUIS redirige explicitement vers
 * /connexion.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SiteHeader from "../components/SiteHeader";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: pushMock }),
}));

const signOut = jest.fn();
const maybeSingle = jest.fn();

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: { signOut: (...args) => signOut(...args) },
    from: jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: (...args) => maybeSingle(...args) }) }),
    })),
  },
}));

const session = { user: { id: "user-1", email: "test@example.com" } };

beforeEach(() => {
  pushMock.mockClear();
  signOut.mockReset().mockResolvedValue({ error: null });
  maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
});

test("aucun pseudo renseigné : affiche l'email en repli", async () => {
  render(<SiteHeader session={session} />);
  expect(await screen.findByText("test@example.com")).toBeInTheDocument();
});

test("pseudo renseigné : affiche le pseudo plutôt que l'email", async () => {
  maybeSingle.mockResolvedValue({ data: { nom_utilisateur: "Bayane" }, error: null });
  render(<SiteHeader session={session} />);

  expect(await screen.findByText("Bayane")).toBeInTheDocument();
  expect(screen.queryByText("test@example.com")).not.toBeInTheDocument();
});

test("sans session : ni email/pseudo ni bouton \"Se déconnecter\"", () => {
  render(<SiteHeader session={null} />);
  expect(screen.queryByRole("button", { name: /se déconnecter/i })).not.toBeInTheDocument();
});

test('"Se déconnecter" appelle signOut() puis redirige vers /connexion', async () => {
  render(<SiteHeader session={session} />);
  fireEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));

  await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/connexion"));
});

