/**
 * @jest-environment jsdom
 *
 * components/SiteHeader.js — le lien "Admin" n'apparaît dans la navigation QUE pour
 * le propriétaire (voir PROMPT étape 5) : "pour tous les autres, elle n'existe pas
 * visuellement". /api/whoami ne renvoie qu'un booléen, jamais une donnée sensible —
 * ceci reste un confort d'affichage, la vraie protection est côté serveur
 * (pages/admin.js, voir __tests__/admin-page.test.js).
 */
import { render, screen, waitFor } from "@testing-library/react";
import SiteHeader from "../components/SiteHeader";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/" }),
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));

const session = { user: { id: "user-1", email: "test@example.com" } };

beforeEach(() => {
  global.fetch = jest.fn();
});

test("compte non-propriétaire (whoami: false) : aucun lien \"Admin\"", async () => {
  global.fetch.mockResolvedValue({ json: () => Promise.resolve({ isOwner: false }) });
  render(<SiteHeader session={session} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/whoami"));
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});

test("compte propriétaire (whoami: true) : le lien \"Admin\" apparaît, vers /admin", async () => {
  global.fetch.mockResolvedValue({ json: () => Promise.resolve({ isOwner: true }) });
  render(<SiteHeader session={session} />);

  const link = await screen.findByRole("link", { name: "Admin" });
  expect(link).toHaveAttribute("href", "/admin");
});

test("échec réseau de /api/whoami : pas de lien \"Admin\" (jamais un plantage de l'en-tête)", async () => {
  global.fetch.mockRejectedValue(new Error("network down"));
  render(<SiteHeader session={session} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});

test("sans session : aucun appel à /api/whoami, aucun lien \"Admin\"", () => {
  render(<SiteHeader session={null} />);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});
