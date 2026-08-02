/**
 * Garde-fou écrit après un signalement réel : la Russie (Premier Ligue) et le Japon
 * (J1 League) n'apparaissaient nulle part sur le site alors que bien réels. L'audit du
 * code n'a trouvé aucune liste blanche/noire de compétitions (voir déjà
 * no-competition-whitelist.test.js et matches-worldwide-coverage.test.js), mais a
 * révélé que lib/apiFootball.js ne suivait JAMAIS la pagination de l'API — un jour
 * chargé (toutes fédérations confondues) dépasse largement les ~100 résultats d'une
 * page, et les petites fédérations (souvent classées après les plus grandes côté API)
 * disparaissaient silencieusement. Ce fichier échoue si cette régression (ou toute
 * nouvelle restriction par ligue/pays) revient.
 */
const fs = require("fs");
const path = require("path");

jest.mock("../lib/pronosticHistory", () => ({ maybeSweepFinishedPredictions: jest.fn() }));

const FD_TOKEN = "test-fd-token";
const AF_KEY = "test-af-key";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn();
  return res;
}

function afFixture(i, { leagueId, leagueName, country, status = "NS" }) {
  return {
    fixture: { id: 8000 + i, date: new Date(Date.now() + 3 * 3600000).toISOString(), status: { short: status } },
    league: { id: leagueId, name: leagueName, country, logo: "" },
    teams: {
      home: { id: 9000 + i, name: `Domicile ${i}`, logo: "" },
      away: { id: 9100 + i, name: `Extérieur ${i}`, logo: "" },
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = FD_TOKEN;
  process.env.API_FOOTBALL_KEY = AF_KEY;
});

test("aucune liste fermée de ligues/pays (whitelist ou blacklist) n'existe dans lib/apiFootball.js ni dans les routes de matchs", () => {
  const files = ["../lib/apiFootball.js", "../pages/api/matches.js", "../pages/api/live-matches.js"].map((p) =>
    fs.readFileSync(path.join(__dirname, p), "utf8")
  );
  for (const src of files) {
    expect(src).not.toMatch(/ALLOWED_LEAGUES|LEAGUE_WHITELIST|LEAGUE_BLACKLIST|POPULAR_LEAGUES|LEAGUE_IDS\s*=\s*\[/);
    // Pas de comparaison d'id de ligue à une valeur/liste codée en dur utilisée comme filtre.
    expect(src).not.toMatch(/league\??\.id\)?\s*===?\s*\d/);
    // Pas de filtre par pays via une liste fermée de noms.
    expect(src).not.toMatch(/country.*\.includes\(/i);
  }
});

test("aucun filtre sur le type de compétition (League/Cup) ni sur le nom (Super Cup, U19/U20, Women, Friendly...) dans les routes de matchs", () => {
  const files = ["../lib/apiFootball.js", "../pages/api/matches.js", "../pages/api/live-matches.js"].map((p) =>
    fs.readFileSync(path.join(__dirname, p), "utf8")
  );
  for (const src of files) {
    // Une Supercoupe n'est ni "League" ni "Cup" : garder uniquement ces deux types
    // exclurait toutes les supercoupes du monde d'un coup (signalement réel : Supercoupe
    // des Pays-Bas absente).
    expect(src).not.toMatch(/league\??\.type\s*===?\s*["']/);
    expect(src).not.toMatch(/\.type\s*!==?\s*["'](League|Cup)["']/);
    // Aucune exclusion par mot-clé du nom de la compétition ou de l'équipe.
    expect(src).not.toMatch(/\b(U1[7-9]|U20|U21|Women|Friendly|Reserve|Youth)\b.*\.(includes|test|match)\(/);
  }
});

test("l'absence de API_FOOTBALL_KEY est journalisée explicitement (jamais un échec silencieux indiscernable d'un vrai 0 match)", () => {
  const files = ["../pages/api/matches.js", "../pages/api/live-matches.js"].map((p) =>
    fs.readFileSync(path.join(__dirname, p), "utf8")
  );
  for (const src of files) {
    expect(src).toMatch(/console\.warn\(.*API_FOOTBALL_KEY absente/);
  }
});

test("la requête API-Football ne transmet aucun paramètre de ligue ni de pays — seulement une plage de dates", () => {
  const apiFootballSrc = fs.readFileSync(path.join(__dirname, "../lib/apiFootball.js"), "utf8");
  expect(apiFootballSrc).not.toMatch(/[?&]league=/);
  expect(apiFootballSrc).not.toMatch(/[?&]country=/);
  expect(apiFootballSrc).toMatch(/\/fixtures\?date=\$\{dateStr\}/);
});

test("un match dont l'horaire n'est pas encore officiellement fixé (statut TBD, fréquent pour les compétitions moins suivies/coupes/supercoupes) apparaît quand même dans Matchs à venir", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.includes("v3.football.api-sports.io/fixtures")) {
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");
      const date = parsed.searchParams.get("date");
      const todayIso = new Date().toISOString().slice(0, 10);
      if (date !== todayIso || page !== "1") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [], paging: { current: 1, total: 1 } }) });
      }
      const superCup = afFixture(600, { leagueId: 543, leagueName: "Super Cup", country: "Netherlands", status: "TBD" });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [superCup], paging: { current: 1, total: 1 } }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const superCupComp = res.body.competitions.find((c) => c.area === "Netherlands");
  expect(superCupComp).toBeDefined();
  expect(superCupComp.name).toBe("Super Cup");
});

test("la pagination API-Football est suivie jusqu'au bout : une compétition renvoyée seulement en page 2 apparaît quand même (régression réelle : Russie/Japon absents)", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.includes("v3.football.api-sports.io/fixtures")) {
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");
      const date = parsed.searchParams.get("date");
      const todayIso = new Date().toISOString().slice(0, 10);
      if (date !== todayIso) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [], paging: { current: 1, total: 1 } }) });
      }
      if (page === "1") {
        // Page 1 pleine (100 fixtures fictives, comme un jour chargé toutes fédérations
        // confondues) — la Russie et le Japon ne sont volontairement PAS dedans.
        const filler = Array.from({ length: 100 }, (_, i) =>
          afFixture(i, { leagueId: 1000 + i, leagueName: `Championnat ${i}`, country: "Pays X" })
        );
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: filler, paging: { current: 1, total: 2 } }) });
      }
      if (page === "2") {
        const russia = afFixture(500, { leagueId: 235, leagueName: "Premier League", country: "Russia" });
        const japan = afFixture(501, { leagueId: 98, leagueName: "J1 League", country: "Japan" });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [russia, japan], paging: { current: 2, total: 2 } }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [], paging: { current: 1, total: 1 } }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  const russiaComp = res.body.competitions.find((c) => c.area === "Russia");
  const japanComp = res.body.competitions.find((c) => c.area === "Japan");
  expect(russiaComp).toBeDefined();
  expect(japanComp).toBeDefined();
  expect(japanComp.name).toBe("J1 League");
  // La page 1 (100 championnats fictifs) reste bien présente aussi : ce n'est pas un
  // remplacement de la page 1 par la page 2, mais une vraie fusion des deux.
  expect(res.body.competitions.some((c) => c.name === "Championnat 0")).toBe(true);
});

test("une panne au milieu de la pagination (429 quota après la page 1) garde quand même les résultats de la page 1 déjà reçue", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.includes("v3.football.api-sports.io/fixtures")) {
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");
      const date = parsed.searchParams.get("date");
      const todayIso = new Date().toISOString().slice(0, 10);
      if (date !== todayIso) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [], paging: { current: 1, total: 1 } }) });
      }
      if (page === "1") {
        const russia = afFixture(500, { leagueId: 235, leagueName: "Premier League", country: "Russia" });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [russia], paging: { current: 1, total: 2 } }) });
      }
      return Promise.resolve({ ok: false, status: 429 });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.error).toBeUndefined();
  const russiaComp = res.body.competitions.find((c) => c.area === "Russia");
  expect(russiaComp).toBeDefined();
});

test("l'appel diagnostique GET /leagues?current=true (jamais un filtre) ne retarde jamais la réponse — la réponse part sans l'attendre", async () => {
  let leaguesCallResolved = false;
  global.fetch = jest.fn((url) => {
    if (url.includes("/v4/matches?")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    }
    if (url.includes("v3.football.api-sports.io/leagues")) {
      // Ne se résout jamais avant la fin du test — si handler() attendait cet appel,
      // la réponse ne partirait jamais et le test expirerait.
      return new Promise((resolve) => {
        setTimeout(() => {
          leaguesCallResolved = true;
          resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                response: [
                  { league: { id: 235, name: "Premier League" }, country: { name: "Russia" } },
                  { league: { id: 98, name: "J1 League" }, country: { name: "Japan" } },
                ],
              }),
          });
        }, 50);
      });
    }
    if (url.includes("v3.football.api-sports.io/fixtures")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [], paging: { current: 1, total: 1 } }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ standings: [{ table: [] }] }) });
  });

  const { default: handler } = await import("../pages/api/matches.js");
  const res = mockRes();
  await handler({}, res);

  expect(res.body.error).toBeUndefined();
  expect(leaguesCallResolved).toBe(false); // la réponse est bien partie avant que /leagues n'ait fini

  // Laisse l'appel diagnostique en arrière-plan se terminer proprement avant la fin du
  // test (sinon Jest avertit d'un log après coup) — sans jamais faire dépendre la
  // réponse HTTP elle-même de cette attente, déjà prouvée ci-dessus.
  await new Promise((resolve) => setTimeout(resolve, 60));
});
