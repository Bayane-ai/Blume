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

test("football est le sport par défaut ; les trois sports sont désormais implémentés (blocs 1 à 9)", () => {
  expect(DEFAULT_SPORT).toBe("football");
  expect(SPORTS.find((s) => s.id === "football").implemented).toBe(true);
  expect(SPORTS.find((s) => s.id === "basketball").implemented).toBe(true);
  expect(SPORTS.find((s) => s.id === "tennis").implemented).toBe(true);
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

  // Tennis (Live Tennis API — voir __tests__/tennis-provider.test.js,
  // __tests__/tennis-mapper.test.js, __tests__/tennis-live-pronostic.test.js pour la
  // couverture complète). Plan gratuit limité au direct (voir lib/sports/tennis/
  // provider.js) : pas de getMatchesByDate/getRankings/getPlayerStatistics/
  // getHeadToHead comme l'ancienne intégration API-Sports, désormais impossibles à
  // honorer honnêtement avec cette source. L'appel SANS argument ci-dessous teste
  // seulement le repli honnête de computePronostic() quand aucune donnée n'est
  // fournie — pas une limitation du sport lui-même (voir pages/api/tennis/analyze.js
  // pour l'appel réel).
  test("tennis expose un provider réel (Live Tennis API), un mapper réel et des pronostics réels", async () => {
    const mod = SPORT_MODULES.tennis;
    expect(mod.implemented).toBe(true);
    expect(typeof mod.provider.getLiveMatches).toBe("function");
    expect(typeof mod.provider.getMatchScore).toBe("function");
    expect(typeof mod.provider.getPlayer).toBe("function");
    expect(typeof mod.mapper.mapMatchToLiveState).toBe("function");

    // Jamais une donnée fictive : sans clé API, le provider renvoie honnêtement une
    // liste vide, jamais un faux match (voir __tests__/tennis-provider.test.js pour
    // la couverture complète avec une vraie clé).
    const live = await mod.provider.getLiveMatches(null);
    expect(live).toEqual([]);

    // Jamais une ligne de pronostic inventée non plus.
    const pronostic = mod.pronostic.computePronostic();
    expect(pronostic.available).toBe(false);
    expect(typeof pronostic.reason).toBe("string");
  });

  // Basket (blocs 1, 3) : provider/mapper/pronostics tous branchés sur de vraies
  // données (voir __tests__/basketball-provider.test.js,
  // __tests__/basketball-mapper.test.js, __tests__/basketball-pronostic-model.test.js
  // pour la couverture complète). L'appel SANS argument ci-dessous teste seulement le
  // repli honnête de computePronostic() quand aucune donnée n'est fournie — pas une
  // limitation du sport lui-même (voir pages/api/basketball/analyze.js pour l'appel réel).
  test("basketball expose un provider réel (API-SPORTS), un mapper réel et des pronostics réels", () => {
    const mod = SPORT_MODULES.basketball;
    expect(mod.implemented).toBe(true);
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
