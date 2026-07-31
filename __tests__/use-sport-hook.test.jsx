/**
 * @jest-environment jsdom
 *
 * lib/useSport.js — sport actuellement sélectionné, lu/écrit dans le cookie
 * blume_prefs (voir lib/prefsCookie.js), partagé entre le sélecteur (components/
 * SportTabs.js) et le contenu de la page via des props (comme `session`).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useSport } from "../lib/useSport";
import { readPrefs } from "../lib/prefsCookie";

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

function TestComponent() {
  const { sport, setSport, sportReady } = useSport();
  if (!sportReady) return <p>Chargement…</p>;
  return (
    <div>
      <p data-testid="current-sport">{sport}</p>
      <button onClick={() => setSport("basketball")}>Basket</button>
      <button onClick={() => setSport("rugby")}>Invalide</button>
    </div>
  );
}

beforeEach(() => {
  clearCookies();
});

test("sans cookie, retombe sur football une fois prêt (jamais un sport indéfini)", async () => {
  render(<TestComponent />);
  await waitFor(() => expect(screen.getByTestId("current-sport")).toHaveTextContent("football"));
});

test("un cookie déjà posé (visite précédente) est bien restauré", async () => {
  document.cookie = `blume_prefs=${encodeURIComponent(JSON.stringify({ sport: "tennis" }))}`;
  render(<TestComponent />);
  await waitFor(() => expect(screen.getByTestId("current-sport")).toHaveTextContent("tennis"));
});

test("setSport met à jour l'état ET écrit le cookie (restauré au retour)", async () => {
  render(<TestComponent />);
  await waitFor(() => expect(screen.getByTestId("current-sport")).toHaveTextContent("football"));

  fireEvent.click(screen.getByText("Basket"));
  await waitFor(() => expect(screen.getByTestId("current-sport")).toHaveTextContent("basketball"));
  expect(readPrefs().sport).toBe("basketball");
});

test("un id de sport invalide est ignoré : ni l'état ni le cookie ne changent", async () => {
  render(<TestComponent />);
  await waitFor(() => expect(screen.getByTestId("current-sport")).toHaveTextContent("football"));

  fireEvent.click(screen.getByText("Invalide"));
  expect(screen.getByTestId("current-sport")).toHaveTextContent("football");
  expect(readPrefs().sport).toBe("football");
});
