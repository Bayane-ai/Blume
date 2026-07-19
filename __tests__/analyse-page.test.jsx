/**
 * @jest-environment jsdom
 *
 * Page "Analyse IA" (pages/analyse.js) : sélection libre de deux équipes réelles
 * (tirées du vrai classement), suggestions cliquables à partir de vrais matchs à
 * venir, et lancement de l'analyse sans aucune exigence de compte supplémentaire
 * au-delà de la connexion déjà obligatoire pour accéder au site.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AnalysePage from "../pages/analyse";

jest.mock("next/router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: "u1", email: "test@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
  },
}));

function mockFetch() {
  global.fetch = jest.fn((url) => {
    if (url.includes("/api/competition-standings")) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            code: "PD",
            table: [
              { position: 1, team: { id: 10, name: "Real Madrid", crest: "" } },
              { position: 2, team: { id: 11, name: "Barcelona", crest: "" } },
            ],
          }),
      });
    }
    if (url.includes("/api/matches")) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            competitions: [{
              code: "PD", name: "LaLiga",
              matches: [{
                id: 1, status: "SCHEDULED", utcDate: "2026-07-25T15:00:00Z",
                homeTeam: { id: 10, name: "Real Madrid", crest: "" },
                awayTeam: { id: 11, name: "Barcelona", crest: "" },
              }],
            }],
          }),
      });
    }
    if (url.includes("/api/compare")) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            available: true,
            probabilities: { home: 55, draw: 25, away: 20 },
            goals: { expectedTotal: 3.1, over25: 60, bttsYes: 45 },
          }),
      });
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });
}

test("choisir les deux équipes puis lancer l'analyse affiche un vrai résultat, sans exiger de compte supplémentaire", async () => {
  mockFetch();
  render(<AnalysePage />);

  await waitFor(() => expect(screen.queryByText(/chargement/i)).not.toBeInTheDocument());

  const selects = await screen.findAllByRole("combobox");
  // selects[0] = compétition, selects[1] = domicile, selects[2] = extérieur
  fireEvent.change(selects[1], { target: { value: "10" } });
  await screen.findByText("Real Madrid");

  const awaySelect = screen.getAllByRole("combobox")[1];
  fireEvent.change(awaySelect, { target: { value: "11" } });
  await screen.findByText("Barcelona");

  const launchBtn = screen.getByRole("button", { name: /lancer l'analyse/i });
  expect(launchBtn).not.toBeDisabled();
  fireEvent.click(launchBtn);

  await screen.findByText("55%");
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/compare?"));
});

test("une suggestion pré-remplit directement les deux équipes", async () => {
  mockFetch();
  render(<AnalysePage />);

  const suggestion = await screen.findByText("Real Madrid - Barcelona");
  fireEvent.click(suggestion);

  await screen.findByText("Real Madrid");
  await screen.findByText("Barcelona");
});

test("une équipe choisie peut être retirée (croix) ou changée", async () => {
  mockFetch();
  render(<AnalysePage />);
  await waitFor(() => expect(screen.queryByText(/chargement/i)).not.toBeInTheDocument());

  const selects = await screen.findAllByRole("combobox");
  fireEvent.change(selects[1], { target: { value: "10" } });
  await screen.findByText("Real Madrid");

  // Une fois l'équipe choisie, son sélecteur devient un bloc "rempli" (plus un
  // <select>) : compétition + extérieur = 2 comboboxes.
  expect(screen.getAllByRole("combobox")).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "Retirer Real Madrid" }));
  // Le slot "Domicile" redevient un sélecteur (le nom ne reste affiché que dans la
  // liste de suggestions, indépendante de la sélection en cours).
  expect(screen.getAllByRole("combobox")).toHaveLength(3);
});
