/**
 * @jest-environment jsdom
 *
 * pages/news.js — onglet "News" : charge les vraies actualités via /api/news,
 * affiche les états chargement/vide/erreur, se rafraîchit automatiquement, et
 * chaque actualité est une vraie carte cliquable.
 */
import { render, screen, waitFor } from "@testing-library/react";
import News from "../pages/news";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/news", push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { email: "test@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
  },
}));

function articlesFixture() {
  return {
    articles: [
      {
        title: "Real Madrid officialise un transfert record",
        link: "https://example.com/major",
        summary: "Résumé.",
        source: "L'Équipe",
        publishedAt: new Date().toISOString(),
        image: "https://example.com/img.jpg",
      },
      {
        title: "Match amical sans enjeu",
        link: "https://example.com/minor",
        summary: "Résumé mineur.",
        source: "Foot Mercato",
        publishedAt: new Date().toISOString(),
        image: null,
      },
    ],
  };
}

beforeEach(() => {
  jest.useRealTimers();
});

test('affiche les vraies actualités reçues de /api/news, chacune sous forme de carte cliquable', async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/news")) return Promise.resolve({ json: () => Promise.resolve(articlesFixture()) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<News />);
  await waitFor(() => expect(screen.getAllByTestId("news-card")).toHaveLength(2));

  const cards = screen.getAllByTestId("news-card");
  expect(cards[0]).toHaveTextContent("Real Madrid officialise un transfert record");
  expect(cards[0]).toHaveAttribute("href", "https://example.com/major");
  expect(cards[1]).toHaveTextContent("Match amical sans enjeu");
});

test("aucune actualité disponible : message clair, jamais une liste vide silencieuse", async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/news")) return Promise.resolve({ json: () => Promise.resolve({ articles: [] }) });
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<News />);
  expect(await screen.findByText("Aucune actualité disponible pour le moment.")).toBeInTheDocument();
});

test("échec réseau : message clair, jamais une page blanche ou un plantage", async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/news")) return Promise.reject(new Error("Erreur réseau"));
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<News />);
  expect(await screen.findByText(/actualités ne sont pas disponibles/i)).toBeInTheDocument();
});

test("se rafraîchit automatiquement en arrière-plan sans effacer les actualités déjà affichées en cas d'erreur passagère", async () => {
  jest.useFakeTimers();
  let call = 0;
  global.fetch = jest.fn((url) => {
    if (url.startsWith("/api/news")) {
      call += 1;
      if (call === 1) return Promise.resolve({ json: () => Promise.resolve(articlesFixture()) });
      return Promise.reject(new Error("Erreur réseau passagère"));
    }
    return Promise.reject(new Error(`URL inattendue : ${url}`));
  });

  render(<News />);
  await waitFor(() => expect(screen.getAllByTestId("news-card")).toHaveLength(2));

  await jest.advanceTimersByTimeAsync(60000);
  expect(screen.getAllByTestId("news-card")).toHaveLength(2);

  jest.useRealTimers();
});
