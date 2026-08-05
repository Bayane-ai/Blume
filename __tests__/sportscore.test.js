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
} from "../lib/sportScore";

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

  test("réseau indisponible : l'erreur remonte à l'appelant", async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error("network unreachable")));
    await expect(fetchSportScoreMatches("football", { fetchImpl })).rejects.toThrow("network unreachable");
  });
});
