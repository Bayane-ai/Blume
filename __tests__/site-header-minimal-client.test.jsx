/**
 * @jest-environment jsdom
 *
 * components/SiteHeader.js : un client Supabase minimal (ex : mock de test qui ne
 * définit que `.auth`, sans `.from`) ne doit jamais empêcher l'affichage de l'email ni
 * la déconnexion — la lecture du pseudo (table "profiles") est un simple confort
 * d'affichage, jamais une dépendance bloquante. Fichier séparé de
 * site-header.test.jsx : ce cas nécessite un mock différent de "../lib/supabaseClient"
 * (sans `.from` du tout).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SiteHeader from "../components/SiteHeader";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: pushMock }),
}));

const signOut = jest.fn();
jest.mock("../lib/supabaseClient", () => ({
  supabase: { auth: { signOut: (...args) => signOut(...args) } },
}));

test("un client Supabase minimal (sans .from) n'empêche jamais l'affichage de l'email ni la déconnexion", async () => {
  render(<SiteHeader session={{ user: { id: "user-1", email: "test@example.com" } }} />);
  expect(await screen.findByText("test@example.com")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  await waitFor(() => expect(signOut).toHaveBeenCalled());
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/connexion"));
});
