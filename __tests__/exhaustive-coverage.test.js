/**
 * Couverture EXHAUSTIVE des compétitions (football + basket) : le code ne doit jamais
 * écarter une compétition. Une compétition ne peut manquer que si le fournisseur ne la
 * propose pas.
 *
 * Ces tests verrouillent les deux plafonds réels qui tronquaient silencieusement la
 * liste avant correction :
 *   - football-data.org /matches : `limit=100` par page, sans pagination ;
 *   - API-Basketball : enveloppe paginée dont seule la 1re page était lue.
 * Dans les deux cas, ce sont les PETITES compétitions qui disparaissaient en premier,
 * classées après les grandes dans l'ordre interne des API.
 */
import { competitionRank } from "../lib/sportScore";

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.resetModules();
  process.env.FOOTBALL_DATA_TOKEN = "fd-token";
  delete process.env.API_FOOTBALL_KEY;
});

// Un échantillon volontairement large : chaque continent, une 2e/3e division, des
// jeunes, du féminin, des réserves, des amicaux — tout doit traverser le pipeline.
const SAMPLE = [
  { comp: "UEFA Champions League", area: "Europe" },
  { comp: "Copa Libertadores", area: "Amérique du Sud" },
  { comp: "CAF Champions League", area: "Afrique" },
  { comp: "AFC Champions League", area: "Asie" },
  { comp: "OFC Champions League", area: "Océanie" },
  { comp: "Premyer Liqa", area: "Azerbaïdjan" },
  { comp: "Championship", area: "Angleterre" },
  { comp: "Serie C Girone B", area: "Italie" },
  { comp: "Regionalliga Nord", area: "Allemagne" },
  { comp: "UEFA Youth League", area: "Europe" },
  { comp: "Premier League U21", area: "Angleterre" },
  { comp: "Liga F", area: "Espagne" },
  { comp: "Coupe de France - Tour préliminaire", area: "France" },
  { comp: "Club Friendlies", area: "Monde" },
];

function fdMatch(i, { comp, area }) {
  return {
    id: 1000 + i,
    utcDate: new Date(Date.now() + (i + 1) * 3600000).toISOString(),
    status: "SCHEDULED",
    competition: { code: `C${i}`, name: comp, area },
    homeTeam: { id: i * 2, name: `H${i}` },
    awayTeam: { id: i * 2 + 1, name: `A${i}` },
  };
}

describe("football-data.org — pagination complète, aucune compétition tronquée", () => {
  test("suit toutes les pages par offset et conserve chaque compétition, y compris petites, jeunes et féminines", async () => {
    // 250 matchs répartis sur les 14 compétitions de l'échantillon : 3 pages.
    const all = Array.from({ length: 250 }, (_, i) => fdMatch(i, SAMPLE[i % SAMPLE.length]));
    const calls = [];
    global.fetch = jest.fn((url) => {
      calls.push(String(url));
      const offset = Number(new URL(String(url)).searchParams.get("offset")) || 0;
      const page = all.slice(offset, offset + 100);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ resultSet: { count: all.length }, matches: page }),
      });
    });

    const { default: handler } = await import("../pages/api/matches.js");
    const res = mockRes();
    await handler({ query: {} }, res);

    // 3 pages lues, jamais une seule.
    expect(calls.filter((u) => u.includes("/matches?")).length).toBe(3);
    expect(calls.some((u) => u.includes("offset=100"))).toBe(true);
    expect(calls.some((u) => u.includes("offset=200"))).toBe(true);

    const returned = res.body.competitions.flatMap((c) => c.matches);
    expect(returned).toHaveLength(all.length);

    // Reçu == affiché, compétition par compétition.
    const names = new Set(res.body.competitions.map((c) => c.name));
    for (const { comp } of SAMPLE) expect(names.has(comp)).toBe(true);
    expect(names.size).toBe(SAMPLE.length);
  });

  test("une page suivante en erreur ne jette pas les pages déjà obtenues", async () => {
    let call = 0;
    global.fetch = jest.fn(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            resultSet: { count: 300 },
            matches: Array.from({ length: 100 }, (_, i) => fdMatch(i, SAMPLE[i % SAMPLE.length])),
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("quota") });
    });

    const { default: handler } = await import("../pages/api/matches.js");
    const res = mockRes();
    await handler({ query: {} }, res);

    // Les 100 premiers matchs restent servis : un résultat partiel réel vaut mieux
    // qu'une page vide (et jamais de donnée inventée pour combler le reste).
    expect(res.body.competitions.flatMap((c) => c.matches).length).toBe(100);
  });

  test("aucun filtre de ligue, de pays ou de division n'est appliqué en sortie", async () => {
    const petites = [
      { comp: "Bhutan Premier League", area: "Bhoutan" },
      { comp: "Fiji National League", area: "Fidji" },
      { comp: "Iceland 3. deild", area: "Islande" },
    ];
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          resultSet: { count: 3 },
          matches: petites.map((c, i) => fdMatch(i, c)),
        }),
      })
    );
    const { default: handler } = await import("../pages/api/matches.js");
    const res = mockRes();
    await handler({ query: {} }, res);

    const names = res.body.competitions.map((c) => c.name);
    for (const { comp } of petites) expect(names).toContain(comp);
  });
});

describe("API-Basketball — pagination complète", () => {
  test("lit toutes les pages annoncées et concatène, jamais seulement la première", async () => {
    process.env.API_BASKETBALL_KEY = "bk";
    const pages = {
      1: { paging: { current: 1, total: 3 }, response: [{ id: 1 }] },
      2: { paging: { current: 2, total: 3 }, response: [{ id: 2 }] },
      3: { paging: { current: 3, total: 3 }, response: [{ id: 3 }] },
    };
    global.fetch = jest.fn((url) => {
      const page = Number(new URL(String(url)).searchParams.get("page")) || 1;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(pages[page]) });
    });

    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    const games = await getLiveGames("bk");
    expect(games.map((g) => g.id)).toEqual([1, 2, 3]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    delete process.env.API_BASKETBALL_KEY;
  });

  test("une page en erreur ne jette pas les précédentes", async () => {
    process.env.API_BASKETBALL_KEY = "bk";
    let call = 0;
    global.fetch = jest.fn(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ paging: { current: 1, total: 5 }, response: [{ id: 1 }] }) });
      }
      return Promise.resolve({ ok: false, status: 500 });
    });
    const { getLiveGames } = await import("../lib/sports/basketball/provider.js");
    expect(await getLiveGames("bk")).toHaveLength(1);
    delete process.env.API_BASKETBALL_KEY;
  });
});

describe("les listes de « grandes compétitions » ne servent QU'AU TRI", () => {
  test.each([
    ["football", "Bhutan Premier League"],
    ["football", "Coupe de France - Tour préliminaire"],
    ["football", "Liga F"],
    ["basketball", "Reserves Cup"],
    ["basketball", "3x3 Open"],
    ["tennis", "ITF M15 Monastir"],
  ])("%s : « %s » reçoit un rang, donc reste affichée (jamais exclue)", (sport, comp) => {
    const rank = competitionRank(comp, sport);
    // Un rang fini = la compétition passe, simplement placée après les grandes.
    expect(Number.isFinite(rank)).toBe(true);
  });

  test("une compétition inconnue est classée APRÈS les grandes, jamais écartée", () => {
    expect(competitionRank("Championnat totalement inconnu", "football"))
      .toBeGreaterThan(competitionRank("UEFA Champions League", "football"));
  });
});
