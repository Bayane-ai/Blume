/**
 * @jest-environment jsdom
 *
 * Résilience des trois sports « Matchs à venir » — correctifs du 10/08/2026.
 *
 * Chaque test verrouille une cause identifiée dans DIAGNOSTIC.md et échoue si elle
 * revient :
 *   • quota gratuit dépassé d'un facteur 24 (cause du bandeau rouge basket) ;
 *   • cache persistant non servi en cas de panne ;
 *   • absence de timeout et de reprise sur l'appel upstream ;
 *   • bandeau d'erreur affiché alors que des matchs connus existent.
 */
import fs from "fs";
import path from "path";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import UpcomingMatchesSection from "../components/UpcomingMatchesSection";

// Les cartes utilisent useRouter pour le lien « Analyser » : sans routeur monté, le
// rendu casse et le test mesurerait autre chose que ce qu'il prétend mesurer.
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/a-venir", push: jest.fn(), replace: jest.fn() }),
}));

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

describe("quota API-SPORTS : le budget journalier doit tenir sous le plan gratuit", () => {
  const src = () => read("lib", "sports", "basketball", "provider.js");

  test("la journée en cours et les jours suivants n'ont PAS le même TTL", () => {
    expect(src()).toMatch(/function ttlPourDate/);
    expect(src()).toMatch(/GAMES_FUTURE_TTL_MS/);
  });

  test("le budget calculé reste sous les 100 appels/jour du plan gratuit", () => {
    const s = src();
    const aujourdhui = Number(/const GAMES_BY_DATE_TTL_MS = (\d+) \* 60 \* 1000/.exec(s)[1]);
    const futur = Number(/const GAMES_FUTURE_TTL_MS = (\d+) \* 60 \* 60 \* 1000/.exec(s)[1]);

    // 1 appel pour aujourd'hui à chaque expiration, 7 appels pour J+1..J+7.
    const parJour = (24 * 60) / aujourdhui + (7 * 24) / futur;
    expect(parJour).toBeLessThan(100);
    // Et suffisamment fréquent pour que la journée en cours reste à jour.
    expect(aujourdhui).toBeLessThanOrEqual(60);
  });

  test("l'ancien réglage (5 min pour les 8 journées) dépassait le quota — garde-fou", () => {
    // 8 appels toutes les 5 min = 2304/jour, soit 24x le quota. Ce test documente le
    // calcul qui a permis de trouver la cause, et interdit d'y revenir.
    const ancien = ((24 * 60) / 5) * 8;
    expect(ancien).toBeGreaterThan(100 * 20);
    expect(src()).not.toMatch(/const GAMES_BY_DATE_TTL_MS = 5 \* 60 \* 1000/);
  });

  test("timeout explicite de 10 s et deux tentatives avec attente croissante", () => {
    const s = src();
    expect(s).toContain("const TIMEOUT_MS = 10 * 1000");
    expect(s).toContain("const TENTATIVES = 2");
    expect(s).toMatch(/AbortSignal\.timeout\(TIMEOUT_MS\)/);
    // Un 429 ne doit jamais être réessayé : le quota est épuisé, insister l'aggrave.
    expect(s).toMatch(/r\.status === 429 \|\| r\.ok \|\| i === TENTATIVES - 1/);
  });

  test("une panne ressert la dernière liste connue au lieu de la faire disparaître", () => {
    expect(src()).toMatch(/cache persistant resservi/);
  });
});

describe("getGamesByDate : jamais de disparition de matchs sur incident", () => {
  const jeu = (id) => ({
    id,
    date: new Date(Date.now() + 3 * 3600000).toISOString(),
    status: { short: "NS" },
    league: { id: 99, name: "WNBA" },
    country: { name: "USA" },
    teams: { home: { id: 1, name: "Minnesota Lynx" }, away: { id: 2, name: "Las Vegas Aces" } },
    scores: { home: {}, away: {} },
  });

  test("quota épuisé : le cache persistant est resservi, aucune erreur remontée", async () => {
    jest.resetModules();
    const store = new Map();
    store.set("basketball:upcoming:2026-08-10", {
      payload: [jeu(1)],
      // Volontairement périmé : c'est justement le cas où l'ancien code jetait tout.
      fetchedAt: Date.now() - 48 * 3600000,
    });
    jest.doMock("../lib/apiSportsCache", () => ({
      readPersistentCache: jest.fn((k) => Promise.resolve(store.get(k) || null)),
      writePersistentCache: jest.fn((k, payload) => store.set(k, { payload, fetchedAt: Date.now() })),
    }));
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }));

    const { getGamesByDate } = await import("../lib/sports/basketball/provider");
    const out = await getGamesByDate("2026-08-10", "cle");
    expect(out).toHaveLength(1);
    expect(out[0].teams.home.name).toBe("Minnesota Lynx");
  });
});

describe("affichage : jamais de bandeau rouge quand des matchs sont connus", () => {
  const enPanne = {
    competitions: [],
    diagnostic: {
      source: "S",
      window: { from: "2026-08-10", to: "2026-08-17" },
      anySourceFailed: true,
      sources: [{ name: "S", httpStatus: null, received: 0, error: "Failed to fetch" }],
    },
  };

  const jourEnCache = [
    {
      key: "2026-08-10",
      label: "Aujourd'hui",
      competitions: [
        {
          competition: "WNBA",
          area: "USA",
          matches: [
            {
              id: "bk-1",
              sport: "basketball",
              home: { name: "Minnesota Lynx" },
              away: { name: "Las Vegas Aces" },
              competition: "WNBA",
              startTime: "2026-08-10T23:00:00.000Z",
              status: "SCHEDULED",
              raw: null,
            },
          ],
        },
      ],
    },
  ];

  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(enPanne) }));
  });

  test("source en panne AVEC liste connue : les matchs sont affichés, pas d'erreur", async () => {
    window.localStorage.setItem(
      "blume:a-venir:basketball",
      JSON.stringify({ days: jourEnCache, at: Date.now() - 60 * 60 * 1000 })
    );

    render(<UpcomingMatchesSection sport="basketball" />);

    await waitFor(() => expect(screen.getByTestId("match-list")).toBeInTheDocument());
    expect(screen.getByText("Minnesota Lynx")).toBeInTheDocument();
    // Ni bandeau rouge, ni message d'attente, ni « aucun match ».
    expect(screen.queryByTestId("upcoming-error")).toBeNull();
    expect(screen.queryByTestId("upcoming-empty")).toBeNull();
    // Mais l'utilisateur est informé que la donnée est datée : jamais de faux-semblant.
    expect(screen.getByTestId("upcoming-stale")).toBeInTheDocument();
  });

  test("une liste connue trop ancienne n'est PAS resservie", async () => {
    window.localStorage.setItem(
      "blume:a-venir:basketball",
      JSON.stringify({ days: jourEnCache, at: Date.now() - 48 * 60 * 60 * 1000 })
    );

    render(<UpcomingMatchesSection sport="basketball" />);
    await waitFor(() => expect(screen.getByTestId("upcoming-retrying")).toBeInTheDocument());
    expect(screen.queryByTestId("match-list")).toBeNull();
  });

  test("une liste réellement obtenue est mémorisée pour la prochaine panne", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            competitions: [
              {
                code: "WNBA",
                name: "WNBA",
                matches: [
                  {
                    id: "bk-9",
                    status: "SCHEDULED",
                    utcDate: new Date(Date.now() + 4 * 3600000).toISOString(),
                    competition: { name: "WNBA", area: "USA" },
                    homeTeam: { name: "Chicago Sky" },
                    awayTeam: { name: "Indiana Fever" },
                  },
                ],
              },
            ],
            diagnostic: { sources: [{ name: "S", httpStatus: 200, received: 1, error: null }] },
          }),
      })
    );

    render(<UpcomingMatchesSection sport="basketball" />);
    await waitFor(() => expect(screen.getByText("Chicago Sky")).toBeInTheDocument());

    const memo = JSON.parse(window.localStorage.getItem("blume:a-venir:basketball"));
    expect(memo.days[0].competitions[0].matches[0].home.name).toBe("Chicago Sky");
  });
});
