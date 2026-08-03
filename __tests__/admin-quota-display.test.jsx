/**
 * @jest-environment jsdom
 *
 * pages/admin.js — section "Consommation API du jour, par sport" (voir PROMPT item 3 :
 * "page d'administration simple me montrant, par sport, les requêtes consommées
 * aujourd'hui et ce qu'il reste"). Rendu à partir des props déjà calculées côté
 * serveur (getServerSideProps, voir __tests__/admin-page.test.js pour la protection
 * d'accès et la forme des props) — ce fichier vérifie uniquement l'affichage.
 */
import { render, screen } from "@testing-library/react";
import Admin from "../pages/admin";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/admin" }),
}));

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ isOwner: true }) }));
});

test("affiche la consommation réelle (requêtes utilisées + restantes) pour chaque sport suivi", () => {
  const quotaSnapshots = [
    { sport: "football", requestsUsed: 42, requestsRemaining: 58, requestsLimit: 100, updatedAt: new Date(Date.now() - 5 * 60000).toISOString() },
    { sport: "basketball", requestsUsed: 7, requestsRemaining: 93, requestsLimit: 100, updatedAt: new Date(Date.now() - 2 * 60000).toISOString() },
  ];
  render(<Admin adminEmail="admin@example.com" quotaSnapshots={quotaSnapshots} />);

  const football = screen.getByTestId("admin-quota-football");
  expect(football).toHaveTextContent("42 requêtes utilisées aujourd'hui");
  expect(football).toHaveTextContent("58 restantes / 100");

  const basketball = screen.getByTestId("admin-quota-basketball");
  expect(basketball).toHaveTextContent("7 requêtes utilisées aujourd'hui");
  expect(basketball).toHaveTextContent("93 restantes / 100");
});

test("aucune requête connue pour un sport (quota jamais lu) : message honnête, jamais une valeur inventée", () => {
  const quotaSnapshots = [
    { sport: "football", requestsUsed: 0, requestsRemaining: null, requestsLimit: null, updatedAt: null },
    { sport: "basketball", requestsUsed: 0, requestsRemaining: null, requestsLimit: null, updatedAt: null },
  ];
  render(<Admin adminEmail="admin@example.com" quotaSnapshots={quotaSnapshots} />);

  const football = screen.getByTestId("admin-quota-football");
  expect(football).toHaveTextContent("Quota restant : indisponible (aucun en-tête reçu pour l'instant)");
  expect(football).toHaveTextContent("Aucune requête effectuée aujourd'hui");
});

test("les deux sports (football, basketball) apparaissent toujours, dans cet ordre", () => {
  const quotaSnapshots = [
    { sport: "football", requestsUsed: 1, requestsRemaining: 99, requestsLimit: 100, updatedAt: null },
    { sport: "basketball", requestsUsed: 1, requestsRemaining: 99, requestsLimit: 100, updatedAt: null },
  ];
  render(<Admin adminEmail="admin@example.com" quotaSnapshots={quotaSnapshots} />);

  const grid = screen.getByTestId("admin-quota-grid");
  const cards = grid.querySelectorAll("[data-testid^='admin-quota-']");
  expect(cards[0]).toHaveAttribute("data-testid", "admin-quota-football");
  expect(cards[1]).toHaveAttribute("data-testid", "admin-quota-basketball");
});
