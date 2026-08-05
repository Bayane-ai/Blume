/**
 * lib/sportScore.js — source des sections "Matchs de football/tennis à venir"
 * (voir pages/matchs-du-jour.js) : API publique SportScore, appelée directement depuis
 * le navigateur, sans clé et sans backend.
 *
 * L'endpoint et ses paramètres sont VÉRIFIÉS (code du wrapper MCP officiel de
 * SportScore, qui mappe 1:1 les endpoints REST documentés) ; les NOMS des champs de la
 * réponse n'ont PAS pu l'être depuis l'environnement de développement — d'où le mapper
 * défensif testé ici, qui ne doit jamais planter ni inventer de valeur.
 */
import {
  matchesUrl, unwrapMatches, mapStatus, mapSportScoreMatch,
  competitionRank, sortMatches, fetchSportScoreMatches,
  readCachedMatches, writeCachedMatches,
  fetchMatchesWithFallback, mapBlumeMatch,
} from "../lib/sportScore";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}

describe("matchesUrl", () => {
  test("construit exactement l'URL documentée, sans aucune clé API", () => {
    expect(matchesUrl("football", 50)).toBe("https://sportscore.com/api/widget/matches/?sport=football&limit=50");
    expect(matchesUrl("tennis", 50)).toBe("https://sportscore.com/api/widget/matches/?sport=tennis&limit=50");
    expect(matchesUrl("football")).not.toMatch(/key|token|apikey/i);
  });

  test("borne limit sur le plafond réel de l'API (1..50), jamais une valeur refusée en amont", () => {
    expect(matchesUrl("football", 999)).toContain("limit=50");
    expect(matchesUrl("football", 0)).toContain("limit=50");
    expect(matchesUrl("football", 10)).toContain("limit=10");
  });
});

describe("unwrapMatches — la liste peut être nue ou enveloppée", () => {
  test.each([
    ["tableau nu", [{ id: 1 }]],
    ["{ matches }", { matches: [{ id: 1 }] }],
    ["{ data }", { data: [{ id: 1 }] }],
    ["{ results }", { results: [{ id: 1 }] }],
    ["{ data: { matches } }", { data: { matches: [{ id: 1 }] } }],
  ])("accepte %s", (_label, payload) => {
    expect(unwrapMatches(payload)).toHaveLength(1);
  });

  test("forme inattendue : liste vide honnête, jamais un plantage", () => {
    expect(unwrapMatches(null)).toEqual([]);
    expect(unwrapMatches({ foo: "bar" })).toEqual([]);
  });
});

describe("mapStatus", () => {
  test.each([
    ["not_started", "upcoming"],
    ["scheduled", "upcoming"],
    ["NS", "upcoming"],
    ["live", "live"],
    ["1st Half", "live"],
    ["inprogress", "live"],
    ["finished", "finished"],
    ["Full Time", "finished"],
    ["FT", "finished"],
  ])("reconnaît %s -> %s", (raw, expected) => {
    expect(mapStatus({ status: raw })).toBe(expected);
  });

  test("accepte un statut imbriqué ({ status: { type } })", () => {
    expect(mapStatus({ status: { type: "finished" } })).toBe("finished");
  });

  test("statut inconnu : tranche sur l'heure réelle de coup d'envoi, jamais au hasard", () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    const past = new Date(Date.now() - 3600000).toISOString();
    expect(mapStatus({ status: "???", start_at: future })).toBe("upcoming");
    expect(mapStatus({ status: "???", start_at: past })).toBe("finished");
  });
});

describe("mapSportScoreMatch — mapper défensif", () => {
  test("forme principale attendue : équipes, logos, compétition, horaire, statut", () => {
    const m = mapSportScoreMatch(
      {
        id: 42,
        home_team: { name: "Real Madrid", logo: "https://x/rm.png" },
        away_team: { name: "Manchester City", logo: "https://x/mc.png" },
        league: { name: "UEFA Champions League" },
        start_at: "2026-08-10T18:00:00Z",
        status: "not_started",
      },
      "football"
    );
    expect(m.id).toBe("ss-football-42");
    expect(m.home).toMatchObject({ name: "Real Madrid", logo: "https://x/rm.png" });
    expect(m.away).toMatchObject({ name: "Manchester City", logo: "https://x/mc.png" });
    expect(m.competition).toBe("UEFA Champions League");
    expect(m.startTime).toBe("2026-08-10T18:00:00.000Z");
    expect(m.status).toBe("upcoming");
  });

  test("noms de champs alternatifs (home/away, image, tournament, scheduled_at) — jamais une carte vide à tort", () => {
    const m = mapSportScoreMatch(
      {
        slug: "djokovic-vs-alcaraz",
        home: { title: "Novak Djokovic", image: "https://x/nd.png" },
        away: { title: "Carlos Alcaraz", image: "https://x/ca.png" },
        tournament: { name: "Wimbledon" },
        scheduled_at: "2026-08-10T12:00:00Z",
        state: "live",
      },
      "tennis"
    );
    expect(m.home.name).toBe("Novak Djokovic");
    expect(m.away.logo).toBe("https://x/ca.png");
    expect(m.competition).toBe("Wimbledon");
    expect(m.status).toBe("live");
  });

  test("horaire en timestamp UNIX (secondes ou millisecondes)", () => {
    const secs = Math.floor(Date.UTC(2026, 7, 10, 18, 0, 0) / 1000);
    expect(mapSportScoreMatch({ start_at: secs, home: { name: "A" }, away: { name: "B" } }, "football").startTime)
      .toBe("2026-08-10T18:00:00.000Z");
  });

  test("champs absents : null honnête, jamais une valeur inventée, jamais un plantage", () => {
    expect(() => mapSportScoreMatch({}, "football")).not.toThrow();
    const m = mapSportScoreMatch({}, "football", 3);
    expect(m.id).toBe("ss-football-3");
    expect(m.home.name).toBeNull();
    expect(m.competition).toBeNull();
    expect(m.startTime).toBeNull();
  });
});

describe("priorisation des grandes compétitions", () => {
  test("football : LDC/Europa/Conference puis les 5 grands championnats, avant le reste", () => {
    expect(competitionRank("UEFA Champions League", "football")).toBeLessThan(competitionRank("Premier League", "football"));
    expect(competitionRank("Premier League", "football")).toBeLessThan(competitionRank("Match amical", "football"));
    expect(competitionRank("LaLiga", "football")).toBeLessThan(competitionRank("Championnat inconnu", "football"));
  });

  test("tennis : Grand Chelem puis ATP/WTA, avant le reste", () => {
    expect(competitionRank("Wimbledon", "tennis")).toBeLessThan(competitionRank("ATP 250 Metz", "tennis"));
    expect(competitionRank("ATP 250 Metz", "tennis")).toBeLessThan(competitionRank("ITF M15", "tennis"));
  });

  test("basket : NBA puis EuroLeague, avant le reste", () => {
    expect(competitionRank("NBA", "basketball")).toBeLessThan(competitionRank("EuroLeague", "basketball"));
    expect(competitionRank("EuroLeague", "basketball")).toBeLessThan(competitionRank("Liga ACB", "basketball"));
  });

  test("aucun match n'est jamais écarté : les amicaux et petites compétitions restent dans la liste, simplement plus bas", () => {
    const matches = [
      { competition: "Match amical", status: "upcoming", startTime: "2026-08-10T10:00:00Z" },
      { competition: "UEFA Champions League", status: "upcoming", startTime: "2026-08-10T20:00:00Z" },
    ];
    const sorted = sortMatches(matches, "football");
    expect(sorted).toHaveLength(2);
    expect(sorted[0].competition).toBe("UEFA Champions League");
    expect(sorted[1].competition).toBe("Match amical");
  });

  test("à compétition égale : en direct d'abord, puis à venir, puis terminé", () => {
    const matches = [
      { competition: "Premier League", status: "finished", startTime: "2026-08-10T10:00:00Z" },
      { competition: "Premier League", status: "live", startTime: "2026-08-10T12:00:00Z" },
      { competition: "Premier League", status: "upcoming", startTime: "2026-08-10T14:00:00Z" },
    ];
    expect(sortMatches(matches, "football").map((m) => m.status)).toEqual(["live", "upcoming", "finished"]);
  });
});

describe("fetchSportScoreMatches", () => {
  test("appelle la bonne URL et renvoie les matchs normalisés et triés", async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            matches: [
              { id: 1, home_team: { name: "Amical A" }, away_team: { name: "Amical B" }, league: { name: "Friendly" }, status: "not_started" },
              { id: 2, home_team: { name: "Real" }, away_team: { name: "City" }, league: { name: "UEFA Champions League" }, status: "not_started" },
            ],
          }),
      })
    );
    const out = await fetchSportScoreMatches("football", { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://sportscore.com/api/widget/matches/?sport=football&limit=50");
    expect(out.map((m) => m.competition)).toEqual(["UEFA Champions League", "Friendly"]);
  });

  test("écarte un match sans nom d'équipe exploitable (jamais une carte à moitié vide)", async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [{ id: 1 }, { id: 2, home_team: { name: "A" }, away_team: { name: "B" } }] }) })
    );
    expect(await fetchSportScoreMatches("tennis", { fetchImpl })).toHaveLength(1);
  });

  test("HTTP en erreur : lève, pour que l'interface affiche son message de secours", async () => {
    const fetchImpl = jest.fn(() => Promise.resolve({ ok: false, status: 503 }));
    await expect(fetchSportScoreMatches("football", { fetchImpl })).rejects.toThrow(/503/);
  });

  test("réseau indisponible sur les DEUX voies : l'erreur d'origine remonte à l'appelant", async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error("network unreachable")));
    await expect(fetchSportScoreMatches("football", { fetchImpl })).rejects.toThrow("network unreachable");
  });
});

// Le visiteur ne doit JAMAIS avoir à cliquer ni à quitter le site pour voir les matchs :
// si l'appel direct navigateur vers sportscore.com est refusé (CORS, blocage réseau,
// extension), la même donnée est récupérée via le relais du site (pages/api/sportscore.js)
// — de façon totalement transparente.
describe("repli automatique sur le relais same-origin", () => {
  const okPayload = {
    ok: true,
    json: () => Promise.resolve({ matches: [{ id: 1, home_team: { name: "A" }, away_team: { name: "B" }, league: { name: "NBA" } }] }),
  };

  test("appel direct réussi : le relais n'est jamais sollicité", async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(okPayload));
    const out = await fetchSportScoreMatches("basketball", { fetchImpl });
    expect(out).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("sportscore.com");
  });

  test("appel direct refusé (CORS) : bascule sur /api/sportscore et affiche quand même les matchs", async () => {
    const fetchImpl = jest.fn((url) =>
      String(url).includes("sportscore.com")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(okPayload)
    );
    const out = await fetchSportScoreMatches("basketball", { fetchImpl });
    expect(out).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/sportscore?sport=basketball&limit=50");
  });

  test("appel direct en erreur HTTP : bascule aussi sur le relais", async () => {
    const fetchImpl = jest.fn((url) =>
      String(url).includes("sportscore.com")
        ? Promise.resolve({ ok: false, status: 403 })
        : Promise.resolve(okPayload)
    );
    expect(await fetchSportScoreMatches("football", { fetchImpl })).toHaveLength(1);
    expect(fetchImpl.mock.calls[1][0]).toContain("/api/sportscore");
  });
});

// Aucun "undefined", "null" ou "[object Object]" ne doit jamais atteindre l'écran :
// les chemins de repli du mapper peuvent tomber sur un objet (ex. "league" au lieu de
// "league.name"), que React refuserait d'afficher — ce qui casserait toute la section.
describe("garde-fou d'affichage : jamais de valeur non affichable", () => {
  test("une compétition renvoyée comme OBJET devient null, jamais un objet passé à React", () => {
    const m = mapSportScoreMatch(
      { home_team: { name: "A" }, away_team: { name: "B" }, league: { id: 7, country: { name: "X" } } },
      "football"
    );
    expect(m.competition).toBeNull();
  });

  test("un nom ou un logo renvoyé comme objet/tableau devient null", () => {
    const m = mapSportScoreMatch({ home_team: { name: { fr: "A" }, logo: ["x"] }, away_team: { name: "B" } }, "football");
    expect(m.home.name).toBeNull();
    expect(m.home.logo).toBeNull();
  });

  test("un nom numérique reste affichable (converti en texte)", () => {
    const m = mapSportScoreMatch({ home_team: { name: 10 }, away_team: { name: "B" } }, "basketball");
    expect(m.home.name).toBe("10");
  });

  test("les espaces seuls comptent comme absents", () => {
    const m = mapSportScoreMatch({ home_team: { name: "   " }, away_team: { name: "B" } }, "football");
    expect(m.home.name).toBeNull();
  });
});

describe("cache local — contenu par défaut au chargement suivant", () => {
  const list = [{ id: "ss-football-1", home: { name: "A" }, away: { name: "B" }, status: "upcoming" }];

  test("écrit puis relit la dernière liste réelle connue", () => {
    const store = memoryStorage();
    writeCachedMatches("football", list, store);
    expect(readCachedMatches("football", store)).toEqual(list);
  });

  test("cloisonné par sport : le basket ne relit jamais la liste du football", () => {
    const store = memoryStorage();
    writeCachedMatches("football", list, store);
    expect(readCachedMatches("basketball", store)).toBeNull();
  });

  test("jamais de liste vide mise en cache (elle ne doit pas écraser une vraie liste)", () => {
    const store = memoryStorage();
    writeCachedMatches("football", [], store);
    expect(readCachedMatches("football", store)).toBeNull();
  });

  test("au-delà de 24h, le cache est ignoré plutôt que présenté comme actuel", () => {
    const store = memoryStorage({
      blume_sportscore_football: JSON.stringify({ savedAt: Date.now() - 25 * 3600 * 1000, matches: list }),
    });
    expect(readCachedMatches("football", store)).toBeNull();
  });

  test("contenu corrompu ou storage indisponible : null honnête, jamais un plantage", () => {
    expect(readCachedMatches("football", memoryStorage({ blume_sportscore_football: "{pas du json" }))).toBeNull();
    expect(() => writeCachedMatches("football", list, null)).not.toThrow();
    expect(readCachedMatches("football", null)).toBeNull();
  });
});

// Repli demandé explicitement : si SportScore ne répond pas, la page bascule sur les
// sources DÉJÀ connectées de Blume au lieu d'afficher une section vide.
describe("repli sur les sources Blume déjà connectées", () => {
  const blumeFootball = {
    ok: true,
    json: () => Promise.resolve({
      competitions: [{
        code: "CL",
        matches: [{
          id: 77, status: "SCHEDULED", utcDate: "2026-08-10T20:00:00Z",
          competition: { name: "UEFA Champions League" },
          homeTeam: { name: "Real Madrid", crest: "https://x/rm.png" },
          awayTeam: { name: "Manchester City", crest: "https://x/mc.png" },
        }],
      }],
    }),
  };

  test("SportScore en panne (direct + relais) : bascule sur /api/matches et affiche de vrais matchs", async () => {
    const fetchImpl = jest.fn((url) =>
      String(url).includes("/api/matches")
        ? Promise.resolve(blumeFootball)
        : Promise.reject(new Error("Failed to fetch"))
    );
    const { matches, source, error } = await fetchMatchesWithFallback("football", { fetchImpl });

    expect(source).toBe("blume");
    expect(matches).toHaveLength(1);
    expect(matches[0].home.name).toBe("Real Madrid");
    expect(matches[0].home.logo).toBe("https://x/rm.png");
    expect(matches[0].competition).toBe("UEFA Champions League");
    expect(matches[0].status).toBe("upcoming");
    // L'erreur SportScore réelle reste exposée : jamais avalée silencieusement.
    expect(error).toMatch(/Failed to fetch/);
  });

  test("chaque sport a bien une source de repli connectée", async () => {
    const seen = [];
    const fetchImpl = jest.fn((url) => {
      const u = String(url);
      if (u.includes("sportscore")) return Promise.reject(new Error("down"));
      seen.push(u);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    });
    for (const sport of ["football", "tennis", "basketball"]) {
      await fetchMatchesWithFallback(sport, { fetchImpl });
    }
    expect(seen).toEqual(["/api/matches", "/api/tennis/live-matches", "/api/basketball/matches"]);
  });

  test("SportScore répond correctement : le repli n'est jamais sollicité", async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [{ id: 1, home_team: { name: "A" }, away_team: { name: "B" } }] }) })
    );
    const { source } = await fetchMatchesWithFallback("football", { fetchImpl });
    expect(source).toBe("sportscore");
    expect(fetchImpl.mock.calls.every(([u]) => String(u).includes("sportscore"))).toBe(true);
  });

  test("les DEUX sources échouent : l'erreur cumulée nomme explicitement chaque cause", async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error("hors service")));
    await expect(fetchMatchesWithFallback("football", { fetchImpl })).rejects.toThrow(/SportScore.*Repli Blume/s);
  });

  test("statuts Blume traduits correctement (IN_PLAY -> live, FINISHED -> terminé)", () => {
    expect(mapBlumeMatch({ status: "IN_PLAY", homeTeam: { name: "A" }, awayTeam: { name: "B" } }, "football").status).toBe("live");
    expect(mapBlumeMatch({ status: "FINISHED", homeTeam: { name: "A" }, awayTeam: { name: "B" } }, "football").status).toBe("finished");
    expect(mapBlumeMatch({ status: "SCHEDULED", homeTeam: { name: "A" }, awayTeam: { name: "B" } }, "football").status).toBe("upcoming");
  });
});
