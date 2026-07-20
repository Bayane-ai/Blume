/**
 * @jest-environment jsdom
 *
 * Bloc 1 — Matchs en live : test complet qui vérifie ensemble les 4 exigences :
 * 1) la page d'accueil affiche par défaut les matchs en direct dès qu'il y en a
 *    (aucun clic, aucun filtre à activer) ;
 * 2) la recherche est mondiale — aucun filtre de compétition, de pays ou de ligue
 *    dans les requêtes envoyées aux deux sources (football-data.org + API-Football) ;
 * 3) les données viennent réellement de la clé API_FOOTBALL_KEY lue depuis les vraies
 *    variables d'environnement (pas une valeur codée en dur), et rien n'est jamais
 *    inventé pour compléter ce que l'API renvoie ;
 * 4) si l'API renvoie 15 à 20 matchs en direct, ils s'affichent TOUS, sans plafond.
 *
 * Limite de cet environnement : cette sandbox n'a aucun accès réseau sortant vers
 * football-data.org ou api-football.com (confirmé à plusieurs reprises dans ce
 * projet) — impossible d'appeler la vraie API depuis ici, avec ou sans clé réelle.
 * Ce test vérifie donc le CONTRAT du code face à un réseau simulé : les bonnes URLs
 * (sans filtre), la vraie variable d'environnement utilisée comme clé
 * d'authentification, et un affichage strictement fidèle à ce que l'API renvoie —
 * comme tous les autres tests de ce projet, football-data.org et API-Football étant
 * tous deux injoignables depuis cet environnement.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import Home from "../pages/index";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: jest.fn(), replace: jest.fn() }),
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

const FD_TOKEN = "real-football-data-token";
const AF_KEY = "real-api-football-key";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function fdMatch(i, compName, compCode) {
  return {
    id: i,
    status: "IN_PLAY",
    minute: 10 + (i % 80),
    utcDate: new Date().toISOString(),
    competition: { code: compCode, name: compName, emblem: "" },
    homeTeam: { id: 2000 + i, name: `Domicile FD ${i}`, crest: "" },
    awayTeam: { id: 3000 + i, name: `Extérieur FD ${i}`, crest: "" },
    score: { fullTime: { home: i % 4, away: (i + 1) % 3 } },
  };
}

function afFixture(i, leagueName) {
  return {
    fixture: { id: 5000 + i, date: new Date().toISOString(), status: { short: "2H", elapsed: 20 + i } },
    league: { id: 900 + i, name: leagueName, logo: "" },
    teams: {
      home: { id: 6000 + i, name: `Domicile AF ${i}`, logo: "" },
      away: { id: 7000 + i, name: `Extérieur AF ${i}`, logo: "" },
    },
    goals: { home: i % 3, away: (i + 2) % 3 },
  };
}

// ---------------------------------------------------------------------------
// 1) La page d'accueil affiche par défaut les matchs en direct dès qu'il y en a.
// ---------------------------------------------------------------------------
describe("Bloc 1.1 — la page d'accueil affiche les matchs en direct par défaut, sans action de l'utilisateur", () => {
  test("dès que l'API renvoie des matchs en direct, ils apparaissent directement au chargement — aucun clic, aucun filtre à activer", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) {
        return Promise.resolve({ json: () => Promise.resolve({ matches: [fdMatch(1, "Premier League", "PL")] }) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    render(<Home />);

    // Le match phare (bandeau "EN DIRECT") reprend le premier match de la liste : le
    // nom de l'équipe apparaît donc deux fois dans le document (phare + carte).
    await waitFor(() => expect(screen.getAllByText("Domicile FD 1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Extérieur FD 1").length).toBeGreaterThan(0);
    expect(screen.getByTestId("featured-match")).toBeInTheDocument();
  });

  test("aucun match en direct : message clair, jamais un match inventé pour remplir l'écran", async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches: [] }) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    render(<Home />);
    await waitFor(() => expect(screen.getByText("Aucun match en direct actuellement.")).toBeInTheDocument());
    expect(screen.queryAllByRole("button", { name: /^analyser$/i })).toHaveLength(0);
    expect(screen.queryByTestId("featured-match")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2) Recherche mondiale : aucun filtre de compétition/pays/ligue dans les requêtes
//    réelles envoyées aux deux sources.
// ---------------------------------------------------------------------------
describe("Bloc 1.2 — recherche mondiale : aucun filtre de compétition, de pays ou de ligue", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.FOOTBALL_DATA_TOKEN = FD_TOKEN;
    process.env.API_FOOTBALL_KEY = AF_KEY;
  });

  test("football-data.org : /v4/matches sans 'competitions' ni 'areas', tous les statuts 'en cours' demandés", async () => {
    const fetchMock = jest.fn((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/v4/matches") {
        expect(parsed.searchParams.has("competitions")).toBe(false);
        expect(parsed.searchParams.has("areas")).toBe(false);
        expect(parsed.searchParams.get("status")).toBe("LIVE,IN_PLAY,PAUSED");
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
      }
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });
    global.fetch = fetchMock;

    const { getLiveMatchesList } = await import("../lib/liveListCache.js");
    await getLiveMatchesList(FD_TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("API-Football : /fixtures?live=all sans 'league', 'country' ni 'season' — couverture mondiale, toutes compétitions", async () => {
    const fetchMock = jest.fn((url) => {
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe("https://v3.football.api-sports.io/fixtures");
      expect(parsed.searchParams.get("live")).toBe("all");
      expect(parsed.searchParams.has("league")).toBe(false);
      expect(parsed.searchParams.has("country")).toBe(false);
      expect(parsed.searchParams.has("season")).toBe(false);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    });
    global.fetch = fetchMock;

    const { getAllLiveFixtures } = await import("../lib/apiFootball.js");
    await getAllLiveFixtures(AF_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("le point d'entrée /api/live-matches interroge bien les deux sources sans filtre, pour une couverture réellement mondiale", async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes("/v4/matches?")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.has("competitions")).toBe(false);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fdMatch(1, "Premier League", "PL")] }) });
      }
      if (url.includes("fixtures?live=all")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.has("league")).toBe(false);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [afFixture(1, "Brasileirão")] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.matches).toHaveLength(2);
    const names = res.body.matches.map((m) => m.competition.name);
    expect(names).toContain("Premier League");
    expect(names).toContain("Brasileirão");
  });
});

// ---------------------------------------------------------------------------
// 3) Les données viennent réellement de la clé API_FOOTBALL_KEY (variable d'env
//    réelle, pas une valeur codée en dur) — et rien n'est jamais inventé.
// ---------------------------------------------------------------------------
describe("Bloc 1.3 — la clé réelle API_FOOTBALL_KEY est utilisée, et aucune donnée n'est jamais inventée", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.FOOTBALL_DATA_TOKEN = FD_TOKEN;
    process.env.API_FOOTBALL_KEY = AF_KEY;
  });

  afterEach(() => {
    delete process.env.API_FOOTBALL_KEY;
  });

  test("pages/api/live-matches.js lit API_FOOTBALL_KEY depuis les vraies variables d'environnement (pas une clé codée en dur) et l'envoie telle quelle en en-tête", async () => {
    const fetchMock = jest.fn((url, opts) => {
      if (url.includes("/v4/matches?")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
      }
      if (url.includes("fixtures?live=all")) {
        expect(opts.headers["x-apisports-key"]).toBe(AF_KEY);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/live-matches.js");
    await handler({}, mockRes());

    expect(fetchMock.mock.calls.some(([url]) => url.includes("fixtures?live=all"))).toBe(true);
  });

  test("sans API_FOOTBALL_KEY dans l'environnement, aucun appel n'est fait à API-Football — jamais une clé de secours inventée", async () => {
    delete process.env.API_FOOTBALL_KEY;
    const fetchMock = jest.fn((url) => {
      if (url.includes("/v4/matches?")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fdMatch(1, "Premier League", "PL")] }) });
      if (url.includes("api-sports") || url.includes("fixtures")) throw new Error("Ne devrait jamais être appelé sans clé");
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.matches).toHaveLength(1); // seulement le vrai match football-data.org
    expect(fetchMock.mock.calls.some(([url]) => url.includes("fixtures"))).toBe(false);
  });

  test("la réponse ne contient jamais plus de matchs que ceux réellement renvoyés par les deux API (aucun complément inventé)", async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes("/v4/matches?")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fdMatch(1, "Premier League", "PL"), fdMatch(2, "LaLiga", "PD")] }) });
      if (url.includes("fixtures?live=all")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [afFixture(1, "Brasileirão")] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    // 2 réels de football-data.org + 1 réel d'API-Football = 3, ni plus ni moins.
    expect(res.body.matches).toHaveLength(3);
  });

  test("une panne d'API-Football ne fait jamais apparaître un match inventé à la place — juste les matchs football-data.org déjà réels", async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes("/v4/matches?")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [fdMatch(1, "Premier League", "PL")] }) });
      if (url.includes("fixtures?live=all")) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0].homeTeam.name).toBe("Domicile FD 1");
  });
});

// ---------------------------------------------------------------------------
// 4) Si l'API renvoie 15 à 20 matchs en direct, ils s'affichent TOUS.
// ---------------------------------------------------------------------------
describe("Bloc 1.4 — 15 à 20 matchs en direct : tous s'affichent, sans plafond artificiel", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.FOOTBALL_DATA_TOKEN = FD_TOKEN;
    process.env.API_FOOTBALL_KEY = AF_KEY;
  });

  afterEach(() => {
    delete process.env.API_FOOTBALL_KEY;
  });

  test("côté API (/api/live-matches) : 12 matchs football-data.org + 5 matchs API-Football uniques = 17 matchs, tous renvoyés", async () => {
    const fdMatches = Array.from({ length: 12 }, (_, i) => fdMatch(i + 1, `Compétition FD ${i + 1}`, `C${i + 1}`));
    const afFixtures = Array.from({ length: 5 }, (_, i) => afFixture(i + 1, `Championnat AF ${i + 1}`));

    const fetchMock = jest.fn((url) => {
      if (url.includes("/v4/matches?")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: fdMatches }) });
      if (url.includes("fixtures?live=all")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: afFixtures }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [] }) });
    });
    global.fetch = fetchMock;

    const { default: handler } = await import("../pages/api/live-matches.js");
    const res = mockRes();
    await handler({}, res);

    expect(res.body.matches).toHaveLength(17);
  });

  test("côté page d'accueil : 17 matchs en direct affichent bien 17 cartes avec bouton ANALYSER, aucune tronquée", async () => {
    const matches = Array.from({ length: 17 }, (_, i) => fdMatch(i + 1, `Compétition ${i + 1}`, `C${i + 1}`));

    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches }) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    render(<Home />);

    const list = await waitFor(() => {
      const el = screen.getByTestId("match-list");
      expect(within(el).getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0);
      return el;
    });

    // Le match phare est un doublon d'affichage du premier match de la liste (pas un
    // match en plus) : 17 boutons ANALYSER dans la liste, un par match reçu de l'API.
    expect(within(list).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(17);
    expect(screen.getByText("Live : 17")).toBeInTheDocument();
    // Le premier match est aussi repris dans le bandeau "match phare" (deux occurrences
    // pour lui) ; tous les autres n'apparaissent qu'une fois, dans leur carte.
    for (let i = 1; i <= 17; i++) {
      expect(screen.getAllByText(`Domicile FD ${i}`).length).toBeGreaterThan(0);
    }
  });

  test("20 matchs en direct (borne haute) : toujours aucun plafond", async () => {
    const matches = Array.from({ length: 20 }, (_, i) => fdMatch(i + 1, `Compétition ${i + 1}`, `C${i + 1}`));
    global.fetch = jest.fn((url) => {
      if (url.startsWith("/api/live-matches")) return Promise.resolve({ json: () => Promise.resolve({ matches }) });
      return Promise.reject(new Error(`URL inattendue : ${url}`));
    });

    render(<Home />);

    const list = await waitFor(() => {
      const el = screen.getByTestId("match-list");
      expect(within(el).getAllByRole("button", { name: /^analyser$/i }).length).toBeGreaterThan(0);
      return el;
    });
    expect(within(list).getAllByRole("button", { name: /^analyser$/i })).toHaveLength(20);
  });
});
