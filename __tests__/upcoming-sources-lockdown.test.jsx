/**
 * @jest-environment jsdom
 *
 * Garde-fous du correctif « basket et tennis n'affichent plus de matchs » (08/08/2026).
 *
 * Chaque test correspond à un point exigé, et échoue si la régression revient :
 *  1. aucun appel direct du NAVIGATEUR vers une API externe (cause du "Failed to fetch"
 *     CORS côté tennis, et fuite des paramètres d'appel) ;
 *  2. /api/basketball/matches ne renvoie JAMAIS de 502 muet ;
 *  3. plus aucune liste blanche ni compétition privilégiée en basket et en tennis ;
 *  6. cascade de sources : « aucun match » interdit tant qu'une source a échoué ;
 *  7. ligne de diagnostic technique réservée à ?debug=1 ;
 *  8. cache serveur de 60 s par sport.
 */
import fs from "fs";
import path from "path";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import UpcomingMatchesSection from "../components/UpcomingMatchesSection";
import { runCascade } from "../lib/sourceCascade";
import { readRouteCache, writeRouteCache, clearRouteCache, ROUTE_CACHE_TTL_MS } from "../lib/routeCache";

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

// Fichiers réellement exécutés dans le navigateur pour cette page.
const CLIENT_FILES = [
  ["lib", "upcomingMatches.js"],
  ["components", "UpcomingMatchesSection.js"],
  ["components", "UpcomingMatchCard.js"],
  ["pages", "a-venir.js"],
];

describe("1. aucun appel direct du navigateur vers une API externe", () => {
  test("aucun fichier client ne contient d'URL absolue vers un domaine tiers", () => {
    for (const parts of CLIENT_FILES) {
      const src = read(...parts);
      const absolute = src.match(/["'`]https?:\/\/[^"'`]+/g) || [];
      expect({ file: parts.join("/"), absolute }).toEqual({ file: parts.join("/"), absolute: [] });
    }
  });

  test("le client n'appelle que /api/<sport>/matches, une route same-origin par sport", () => {
    const src = read("lib", "upcomingMatches.js");
    expect(src).toContain('football: "/api/football/matches"');
    expect(src).toContain('basketball: "/api/basketball/matches"');
    expect(src).toContain('tennis: "/api/tennis/matches"');
    // Plus aucune trace du client SportScore appelé depuis le navigateur.
    expect(src).not.toMatch(/fetchSportScoreMatches|sportscore\.com/i);
  });

  test("les trois routes existent réellement côté serveur", () => {
    for (const p of [
      ["pages", "api", "football", "matches.js"],
      ["pages", "api", "basketball", "matches.js"],
      ["pages", "api", "tennis", "matches.js"],
    ]) {
      expect(fs.existsSync(path.join(__dirname, "..", ...p))).toBe(true);
    }
  });
});

describe("2. les routes 'à venir' ne renvoient jamais d'erreur HTTP", () => {
  test("aucun status 4xx/5xx dans les routes basket et tennis", () => {
    for (const p of [
      ["pages", "api", "basketball", "matches.js"],
      ["pages", "api", "tennis", "matches.js"],
    ]) {
      const src = read(...p);
      const bad = src.match(/res\.status\(\s*[45]\d\d\s*\)/g) || [];
      expect({ file: p.join("/"), bad }).toEqual({ file: p.join("/"), bad: [] });
    }
  });

  test("une journée en échec n'emporte plus les autres (Promise.allSettled, jamais Promise.all)", () => {
    const src = read("pages", "api", "basketball", "matches.js");
    expect(src).toContain("Promise.allSettled");
    expect(src).not.toMatch(/Promise\.all\(/);
  });
});

describe("3. aucune compétition privilégiée ni liste blanche en basket et tennis", () => {
  test("les listes de compétitions majeures basket/tennis sont vides", () => {
    const src = read("lib", "sportScore.js");
    expect(src).toMatch(/const TENNIS_MAJORS = \[\];/);
    expect(src).toMatch(/const BASKETBALL_MAJORS = \[\];/);
  });

  test("le texte d'introduction ne promet plus un ordre NBA/EuroLeague/ATP/WTA", () => {
    const src = read("pages", "a-venir.js");
    expect(src).not.toMatch(/NBA et EuroLeague en tête/i);
    expect(src).not.toMatch(/ATP et WTA en tête/i);
  });
});

describe("aucun match n'est écarté par le code lui-même", () => {
  // Régression traquée : `if (!code) continue` supprimait en silence tout match dont
  // la compétition n'a pas d'identifiant chez la source (fréquent sur les tournois
  // d'été et les compétitions secondaires). La source l'avait renvoyé, le site ne
  // l'affichait pas — indiscernable d'un "aucun match" légitime.
  test("les routes ne sautent plus un match faute d'identifiant de compétition", () => {
    for (const p of [
      ["pages", "api", "matches.js"],
      ["pages", "api", "basketball", "matches.js"],
    ]) {
      expect(read(...p)).not.toMatch(/if \(!code\) continue;/);
    }
  });

  test("un match sans identifiant de compétition est quand même groupé, sous son nom", async () => {
    process.env.API_BASKETBALL_KEY = "k";
    jest.resetModules();
    const soon = new Date(Date.now() + 5 * 3600000).toISOString();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          response: [
            {
              id: 1,
              date: soon,
              status: { short: "NS" },
              // league.id ABSENT : c'est le cas qui faisait disparaître le match.
              league: { name: "WNBA" },
              country: { name: "USA" },
              teams: { home: { id: 40, name: "Minnesota Lynx" }, away: { id: 41, name: "Las Vegas Aces" } },
              scores: { home: {}, away: {} },
            },
          ],
        }),
      })
    );
    const { default: handler } = await import("../pages/api/basketball/matches.js");
    const res = { status: jest.fn(function () { return this; }), setHeader: jest.fn(), json: jest.fn(function (b) { this.body = b; return this; }) };
    await handler({}, res);

    expect(res.body.competitions.map((c) => c.name)).toContain("WNBA");
    const wnba = res.body.competitions.find((c) => c.name === "WNBA");
    expect(wnba.matches.map((m) => m.homeTeam.name)).toContain("Minnesota Lynx");
  });
});

describe("6. cascade de sources", () => {
  test("une source principale à 0 déclenche la source secondaire", async () => {
    const calls = [];
    const out = await runCascade([
      { name: "principale", run: async () => { calls.push("principale"); return { matches: [], httpStatus: 200 }; } },
      { name: "secours", run: async () => { calls.push("secours"); return { matches: [{ id: 1 }], httpStatus: 200 }; } },
    ]);
    expect(calls).toEqual(["principale", "secours"]);
    expect(out.matches).toHaveLength(1);
    expect(out.allSourcesFailed).toBe(false);
    expect(out.anySourceFailed).toBe(false);
  });

  test("une source productive arrête la cascade : le quota des suivantes est préservé", async () => {
    const calls = [];
    await runCascade([
      { name: "principale", run: async () => { calls.push("principale"); return [{ id: 1 }]; } },
      { name: "secours", run: async () => { calls.push("secours"); return [{ id: 2 }]; } },
    ]);
    expect(calls).toEqual(["principale"]);
  });

  test("une source en panne est signalée, jamais avalée", async () => {
    const out = await runCascade([
      { name: "principale", run: async () => { throw new Error("boom"); } },
      { name: "secours", run: async () => ({ matches: [], httpStatus: 200 }) },
    ]);
    expect(out.anySourceFailed).toBe(true);
    expect(out.allSourcesFailed).toBe(false);
    expect(out.error).toBe("boom");
  });

  test("toutes les sources en panne : allSourcesFailed", async () => {
    const out = await runCascade([
      { name: "a", run: async () => { throw new Error("x"); } },
      { name: "b", run: async () => { throw new Error("y"); } },
    ]);
    expect(out.allSourcesFailed).toBe(true);
  });

  test("une source sautée (clé absente) est déclarée, et n'empêche pas les suivantes", async () => {
    const out = await runCascade([
      { name: "principale", skip: "Clé API absente", run: async () => { throw new Error("jamais appelée"); } },
      { name: "secours", run: async () => [{ id: 1 }] },
    ]);
    expect(out.attempts[0]).toMatchObject({ skipped: true, error: "Clé API absente" });
    expect(out.matches).toHaveLength(1);
  });
});

describe("6/7. affichage : vide légitime, panne, et ligne technique réservée à ?debug=1", () => {
  const empty = { competitions: [], diagnostic: { source: "S", window: { from: "2026-08-08", to: "2026-08-15" }, sources: [{ name: "S", httpStatus: 200, received: 0, error: null }] } };
  const broken = { competitions: [], diagnostic: { source: "S", window: { from: "2026-08-08", to: "2026-08-15" }, anySourceFailed: true, sources: [{ name: "S", httpStatus: null, received: 0, error: "Failed to fetch" }] } };

  function mockFetch(payload) {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
  }

  function setUrl(search) {
    window.history.replaceState({}, "", `/a-venir${search}`);
  }

  afterEach(() => setUrl(""));

  test("toutes les sources ont répondu 0 : « aucun match », sans ligne technique par défaut", async () => {
    setUrl("");
    mockFetch(empty);
    render(<UpcomingMatchesSection sport="basketball" />);
    await screen.findByTestId("upcoming-empty");
    expect(screen.queryByTestId("upcoming-empty-diagnostic")).toBeNull();
  });

  test("?debug=1 : la ligne technique réapparaît, avec source, code HTTP et plage", async () => {
    setUrl("?debug=1");
    mockFetch(empty);
    render(<UpcomingMatchesSection sport="basketball" />);
    const diag = await screen.findByTestId("upcoming-empty-diagnostic");
    expect(diag.textContent).toContain("HTTP 200");
    expect(diag.textContent).toContain("2026-08-08");
    expect(diag.textContent).toContain("2026-08-15");
  });

  test("une source en échec : jamais « aucun match », mais une nouvelle tentative annoncée", async () => {
    setUrl("");
    mockFetch(broken);
    render(<UpcomingMatchesSection sport="tennis" />);
    await waitFor(() => expect(screen.getByTestId("upcoming-retrying")).toBeInTheDocument());
    expect(screen.getByText(/Problème de connexion à la source, nouvelle tentative en cours/i)).toBeInTheDocument();
    expect(screen.queryByTestId("upcoming-empty")).toBeNull();
  });
});

describe("8. cache serveur de 60 secondes par sport", () => {
  beforeEach(() => clearRouteCache());

  test("le TTL est bien de 60 secondes", () => {
    expect(ROUTE_CACHE_TTL_MS).toBe(60 * 1000);
  });

  test("une entrée est servie pendant 60 s puis expire", () => {
    const t0 = 1_000_000;
    writeRouteCache("basketball:2026-08-08", { competitions: [] }, { now: t0 });
    expect(readRouteCache("basketball:2026-08-08", { now: t0 + 59_000 })).toEqual({ competitions: [] });
    expect(readRouteCache("basketball:2026-08-08", { now: t0 + 61_000 })).toBeNull();
  });

  test("les sports ne partagent pas leur cache", () => {
    writeRouteCache("basketball:2026-08-08", { competitions: ["b"] });
    expect(readRouteCache("tennis:2026-08-08")).toBeNull();
  });

  test("les trois routes posent bien un cache CDN de 60 s", () => {
    for (const p of [
      ["pages", "api", "matches.js"],
      ["pages", "api", "basketball", "matches.js"],
      ["pages", "api", "tennis", "matches.js"],
    ]) {
      expect(read(...p)).toContain("s-maxage=60");
    }
  });

  test("une réponse dégradée n'est jamais mise en cache (sinon une panne fige le sport)", () => {
    for (const p of [
      ["pages", "api", "basketball", "matches.js"],
      ["pages", "api", "tennis", "matches.js"],
    ]) {
      expect(read(...p)).toContain("if (!cascade.anySourceFailed) writeRouteCache");
    }
  });
});
