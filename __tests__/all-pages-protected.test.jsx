/**
 * @jest-environment jsdom
 *
 * Bloc 4, tâche 3 : "Protège toutes les pages du site : un visiteur non connecté est
 * automatiquement renvoyé vers /connexion. Seul un utilisateur connecté accède au
 * site." — garde-fou de non-régression : chaque page de contenu du site (toutes
 * celles qui utilisent lib/useRequireAuth.js) doit rediriger vers /connexion et ne
 * jamais afficher de contenu protégé quand aucune session n'existe. La page
 * d'authentification elle-même (/connexion) reste volontairement exclue : elle ne
 * doit JAMAIS rediriger un visiteur non connecté.
 */
import { render, screen } from "@testing-library/react";

import Home from "../pages/index";
import UpcomingMatches from "../pages/a-venir";
import CombineVision from "../pages/combine-vision";
import News from "../pages/news";
import CompetitionPage from "../pages/competition/[code]";
import MatchPage from "../pages/match/[id]";
import Historique from "../pages/historique";
import ProbabilitesReussies from "../pages/probabilites-reussies";
import ProbabilitesEchouees from "../pages/probabilites-echouees";

const replaceMock = jest.fn();
const pushMock = jest.fn();
let mockQuery = {};

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: pushMock, replace: replaceMock, isReady: true, query: mockQuery }),
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      // Aucune session : c'est exactement le cas "visiteur non connecté" à vérifier.
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
    from: jest.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    })),
  },
}));

beforeEach(() => {
  replaceMock.mockClear();
  pushMock.mockClear();
  mockQuery = {};
  global.fetch = jest.fn(() => Promise.reject(new Error("aucune requête réseau attendue : la page doit rediriger avant tout chargement de données")));
});

const pages = [
  ["/", Home],
  ["/a-venir", UpcomingMatches],
  ["/combine-vision", CombineVision],
  ["/news", News],
  ["/competition/[code]", CompetitionPage],
  ["/match/[id]", MatchPage],
  ["/historique", Historique],
  ["/probabilites-reussies", ProbabilitesReussies],
  ["/probabilites-echouees", ProbabilitesEchouees],
];

describe.each(pages)("%s : visiteur non connecté", (path, Page) => {
  test("redirige vers /connexion et n'affiche jamais le contenu protégé", async () => {
    const { container } = render(<Page />);

    await screen.findByText(/chargement/i);
    await new Promise((resolve) => setTimeout(resolve, 0)); // laisse getSession() se résoudre

    expect(replaceMock).toHaveBeenCalledWith("/connexion");
    // Aucune requête réseau protégée n'a été déclenchée (voir le rejet forcé de
    // `fetch` ci-dessus : si le test échouait avec une exception non gérée, ce serait
    // le signe qu'une page a chargé ses données AVANT de vérifier la session).
    expect(container.textContent).not.toMatch(/analyser|pronostic/i);
  });
});
