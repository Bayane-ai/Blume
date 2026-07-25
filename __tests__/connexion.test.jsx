/**
 * @jest-environment jsdom
 *
 * Écran d'authentification UNIQUE "/connexion" — plus de mot de passe, plus de code,
 * plus de lien magique, plus de Google : un seul champ (email), un seul bouton
 * ("Continuer"). Au clic, POST /api/auth/login connecte immédiatement (le compte est
 * créé automatiquement si l'email n'existe pas encore). Les messages d'erreur
 * affichés sont ceux renvoyés par l'API elle-même, tels quels.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Connexion from "../pages/connexion";

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  replaceMock.mockClear();
  global.fetch = jest.fn((url) => {
    if (url === "/api/auth/session") return Promise.resolve({ json: () => Promise.resolve({ session: null }) });
    if (url === "/api/auth/login") return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
});

test('affiche un seul champ "Entre ton email" et un seul bouton "Continuer" — jamais de mot de passe, de code ni de Google', () => {
  render(<Connexion />);
  expect(screen.getByPlaceholderText("Entre ton email")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continuer" })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/mot de passe/i)).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/code/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/vérifie ta boîte mail|vérifiez vos emails/i)).not.toBeInTheDocument();
});

test("déjà connecté : redirection immédiate vers l'accueil, sans afficher le formulaire", async () => {
  global.fetch = jest.fn((url) => {
    if (url === "/api/auth/session") return Promise.resolve({ json: () => Promise.resolve({ session: { id: "user-1", email: "test@example.com" } }) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
  render(<Connexion />);
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
});

test("email invalide : message clair, jamais d'appel à l'API", async () => {
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "pas-un-email" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

  await screen.findByText(/adresse email invalide/i);
  expect(global.fetch).not.toHaveBeenCalledWith("/api/auth/login", expect.anything());
});

test("email valide : appelle POST /api/auth/login (email normalisé) puis redirige vers l'accueil — connexion IMMÉDIATE", async () => {
  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "  Test@Example.com  " } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@example.com" }),
  }));
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
});

test("l'API renvoie une erreur précise : affichée telle quelle, jamais \"contactez l'administrateur\"", async () => {
  global.fetch = jest.fn((url) => {
    if (url === "/api/auth/session") return Promise.resolve({ json: () => Promise.resolve({ session: null }) });
    if (url === "/api/auth/login") {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Configuration serveur manquante : AUTH_SESSION_SECRET est vide dans ce déploiement." }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

  expect(await screen.findByText(/AUTH_SESSION_SECRET est vide/i)).toBeInTheDocument();
  expect(screen.queryByText(/contactez l'administrateur/i)).not.toBeInTheDocument();
  expect(pushMock).not.toHaveBeenCalled();
});

test("échec réseau (serveur injoignable) : message clair, pas de redirection", async () => {
  global.fetch = jest.fn((url) => {
    if (url === "/api/auth/session") return Promise.resolve({ json: () => Promise.resolve({ session: null }) });
    if (url === "/api/auth/login") return Promise.reject(new Error("network down"));
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<Connexion />);
  fireEvent.change(screen.getByPlaceholderText("Entre ton email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

  await screen.findByText(/impossible de contacter le serveur/i);
  expect(pushMock).not.toHaveBeenCalled();
});
