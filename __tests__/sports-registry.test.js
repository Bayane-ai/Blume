/**
 * lib/sports/registry.js + lib/sports/index.js — multi-sport (bloc 0) : un seul point
 * de vérité pour la liste des sports (football/basketball/tennis), leur métadonnée et
 * leur module (provider/mapper/pronostic, même interface pour les 3).
 */
import { SPORTS, DEFAULT_SPORT, isValidSport, getSportMeta } from "../lib/sports/registry";
import { SPORT_MODULES, getSportModule } from "../lib/sports";

test("exactement 3 sports, dans l'ordre Football, Basket, Tennis", () => {
  expect(SPORTS.map((s) => s.id)).toEqual(["football", "basketball", "tennis"]);
});

test("football est le sport par défaut et le seul déjà implémenté", () => {
  expect(DEFAULT_SPORT).toBe("football");
  expect(SPORTS.find((s) => s.id === "football").implemented).toBe(true);
  expect(SPORTS.find((s) => s.id === "basketball").implemented).toBe(false);
  expect(SPORTS.find((s) => s.id === "tennis").implemented).toBe(false);
});

test("isValidSport reconnaît les 3 sports réels, rejette un id inconnu", () => {
  expect(isValidSport("football")).toBe(true);
  expect(isValidSport("basketball")).toBe(true);
  expect(isValidSport("tennis")).toBe(true);
  expect(isValidSport("rugby")).toBe(false);
  expect(isValidSport(undefined)).toBe(false);
});

test("getSportMeta retombe honnêtement sur le football pour un id inconnu, jamais undefined", () => {
  expect(getSportMeta("basketball").label).toBe("Basket");
  expect(getSportMeta("n-importe-quoi").id).toBe("football");
  expect(getSportMeta(undefined).id).toBe("football");
});

describe("lib/sports — chaque sport a la même interface", () => {
  test("football : descripteur simple (pas de provider/mapper/pronostic dupliqué — voir le commentaire du fichier)", () => {
    expect(SPORT_MODULES.football.id).toBe("football");
    expect(SPORT_MODULES.football.implemented).toBe(true);
    expect(SPORT_MODULES.football.routes.live).toBe("/api/live-matches");
  });

  test("tennis (pas encore branché, bloc 5) expose provider/mapper/pronostic, honnêtement non implémenté", async () => {
    const mod = SPORT_MODULES.tennis;
    expect(mod.implemented).toBe(false);
    expect(typeof mod.provider.getLiveMatches).toBe("function");
    expect(typeof mod.provider.getUpcomingMatches).toBe("function");
    expect(typeof mod.mapper.mapMatchToLiveState).toBe("function");
    expect(typeof mod.pronostic.computePronostic).toBe("function");

    // Jamais une donnée fictive : le provider renvoie honnêtement "pas encore
    // branché", jamais une liste de faux matchs.
    const live = await mod.provider.getLiveMatches();
    expect(live).toEqual({ implemented: false, matches: [] });
    const upcoming = await mod.provider.getUpcomingMatches();
    expect(upcoming).toEqual({ implemented: false, competitions: [] });

    // Jamais une ligne de pronostic inventée non plus.
    const pronostic = mod.pronostic.computePronostic();
    expect(pronostic.available).toBe(false);
    expect(typeof pronostic.reason).toBe("string");
  });

  // Basket (bloc 1) : provider/mapper branchés sur de vraies données (voir
  // __tests__/basketball-provider.test.js et __tests__/basketball-mapper.test.js
  // pour la couverture complète) — les pronostics restent honnêtement indisponibles
  // (bloc 3 pas encore fait).
  test("basketball expose un provider réel (API-SPORTS) et un mapper réel, pronostics pas encore branchés", () => {
    const mod = SPORT_MODULES.basketball;
    expect(typeof mod.provider.getLiveGames).toBe("function");
    expect(typeof mod.provider.getGamesByDate).toBe("function");
    expect(typeof mod.provider.getStandings).toBe("function");
    expect(typeof mod.provider.getTeamStatistics).toBe("function");
    expect(typeof mod.provider.getPlayerStatistics).toBe("function");
    expect(typeof mod.provider.getLeagues).toBe("function");
    expect(typeof mod.mapper.mapGameToLiveMatch).toBe("function");

    const pronostic = mod.pronostic.computePronostic();
    expect(pronostic.available).toBe(false);
    expect(typeof pronostic.reason).toBe("string");
  });

  test("getSportModule renvoie le bon module, et retombe sur football pour un id inconnu", () => {
    expect(getSportModule("basketball").id).toBe("basketball");
    expect(getSportModule("tennis").id).toBe("tennis");
    expect(getSportModule("rugby").id).toBe("football");
  });
});
