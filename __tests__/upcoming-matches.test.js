/**
 * lib/upcomingMatches.js — couche unifiée de l'onglet "Matchs à venir" (fusion de
 * l'ancien "Matchs du jour"). Agrège SportScore + les sources Blume, déduplique par
 * équipes + horaire, ne garde que les matchs PAS ENCORE COMMENCÉS de maintenant à J+7,
 * puis groupe par jour local et par compétition. Rien n'est jamais exclu par une liste
 * blanche : seules la fenêtre temporelle et le statut filtrent.
 */
import {
  dedupeKey, dedupe, keepUpcoming, localDayKey, dayLabel,
  groupByDayThenCompetition, loadUpcoming, HORIZON_DAYS,
} from "../lib/upcomingMatches";

const NOW = new Date("2026-08-05T12:00:00Z").getTime();
const inHours = (h) => new Date(NOW + h * 3600000).toISOString();

function m(over = {}) {
  return {
    id: "1", sport: "football", home: { name: "Real Madrid" }, away: { name: "Manchester City" },
    competition: "UEFA Champions League", area: null, startTime: inHours(5), status: "SCHEDULED", raw: null,
    ...over,
  };
}

describe("déduplication multi-sources (équipes + horaire)", () => {
  test("même match vu par deux sources : une seule carte", () => {
    const a = m({ id: "ss-1" });
    const b = m({ id: "blume-1", raw: { id: 1 } });
    expect(dedupe([a, b])).toHaveLength(1);
  });

  test("l'ordre domicile/extérieur inversé par une source ne crée pas de doublon", () => {
    const a = m({ id: "a" });
    const b = m({ id: "b", home: { name: "Manchester City" }, away: { name: "Real Madrid" } });
    expect(dedupe([a, b])).toHaveLength(1);
  });

  test("les suffixes de club et les accents ne créent pas de doublon", () => {
    const a = m({ id: "a", home: { name: "Real Madrid CF" }, away: { name: "Manchester City FC" } });
    const b = m({ id: "b" });
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });

  test("un écart de quelques minutes entre sources reste le même match", () => {
    const a = m({ id: "a", startTime: inHours(5) });
    const b = m({ id: "b", startTime: new Date(NOW + 5 * 3600000 + 60000).toISOString() });
    expect(dedupe([a, b])).toHaveLength(1);
  });

  test("deux matchs réellement différents sont conservés tous les deux", () => {
    expect(dedupe([m({ id: "a" }), m({ id: "b", away: { name: "Liverpool" } })])).toHaveLength(2);
  });

  test("à doublon, la version la plus riche est gardée (celle qui permet le lien Analyser)", () => {
    const pauvre = m({ id: "ss", raw: null });
    const riche = m({ id: "blume", raw: { id: 42 } });
    expect(dedupe([pauvre, riche])[0].raw).toEqual({ id: 42 });
  });
});

describe("fenêtre : uniquement les matchs pas encore commencés, de maintenant à J+7", () => {
  test("garde un match à venir dans la fenêtre", () => {
    expect(keepUpcoming([m({ startTime: inHours(5) })], { now: NOW })).toHaveLength(1);
  });

  test("écarte un match déjà commencé ou terminé (ils appartiennent à Live/historique)", () => {
    expect(keepUpcoming([m({ status: "IN_PLAY" })], { now: NOW })).toHaveLength(0);
    expect(keepUpcoming([m({ status: "FINISHED" })], { now: NOW })).toHaveLength(0);
    expect(keepUpcoming([m({ status: "PAUSED" })], { now: NOW })).toHaveLength(0);
  });

  test("écarte un match dont l'heure est déjà passée, même marqué SCHEDULED", () => {
    expect(keepUpcoming([m({ startTime: inHours(-1) })], { now: NOW })).toHaveLength(0);
  });

  test("écarte au-delà de J+7, garde juste en dessous", () => {
    expect(keepUpcoming([m({ startTime: inHours(24 * HORIZON_DAYS + 1) })], { now: NOW })).toHaveLength(0);
    expect(keepUpcoming([m({ startTime: inHours(24 * HORIZON_DAYS - 1) })], { now: NOW })).toHaveLength(1);
  });

  test("écarte un match sans nom d'équipe ou sans horaire (inaffichable)", () => {
    expect(keepUpcoming([m({ home: { name: null } })], { now: NOW })).toHaveLength(0);
    expect(keepUpcoming([m({ startTime: null })], { now: NOW })).toHaveLength(0);
  });
});

describe("groupement jour -> compétition", () => {
  test("libellés Aujourd'hui / Demain, puis date lisible", () => {
    const today = new Date(NOW);
    const key = localDayKey(today.toISOString());
    expect(dayLabel(key, today)).toBe("Aujourd'hui");
    const tomorrow = new Date(NOW + 24 * 3600000);
    expect(dayLabel(localDayKey(tomorrow.toISOString()), today)).toBe("Demain");
    const later = new Date(NOW + 3 * 24 * 3600000);
    expect(dayLabel(localDayKey(later.toISOString()), today)).toMatch(/^[A-ZÀ-Ý]/);
  });

  test("grandes compétitions en tête, toutes les autres conservées en dessous", () => {
    const matches = [
      m({ id: "1", competition: "Bhutan Premier League", startTime: inHours(6) }),
      m({ id: "2", competition: "UEFA Champions League", startTime: inHours(7) }),
      m({ id: "3", competition: "Serie A", startTime: inHours(8) }),
      m({ id: "4", competition: "Youth Cup U17", startTime: inHours(9) }),
    ];
    const days = groupByDayThenCompetition(matches, "football", new Date(NOW));
    const comps = days[0].competitions.map((c) => c.competition);
    expect(comps[0]).toBe("UEFA Champions League");
    expect(comps[1]).toBe("Serie A");
    // Aucune écartée.
    expect(comps).toHaveLength(4);
    expect(comps).toEqual(expect.arrayContaining(["Bhutan Premier League", "Youth Cup U17"]));
  });

  test("dans une compétition, les matchs sont triés par heure croissante", () => {
    const matches = [
      m({ id: "tard", startTime: inHours(9) }),
      m({ id: "tot", startTime: inHours(6), home: { name: "A" }, away: { name: "B" } }),
    ];
    const days = groupByDayThenCompetition(matches, "football", new Date(NOW));
    expect(days[0].competitions[0].matches.map((x) => x.id)).toEqual(["tot", "tard"]);
  });

  test("le pays/fédération accompagne le nom de la compétition quand la source le fournit", () => {
    const days = groupByDayThenCompetition([m({ area: "Espagne", competition: "LaLiga" })], "football", new Date(NOW));
    expect(days[0].competitions[0].area).toBe("Espagne");
  });

  test("les jours sont chronologiques", () => {
    const matches = [m({ id: "j2", startTime: inHours(30) }), m({ id: "j1", startTime: inHours(6) })];
    const days = groupByDayThenCompetition(matches, "football", new Date(NOW));
    expect(new Date(days[0].key) <= new Date(days[1].key)).toBe(true);
  });
});

describe("loadUpcoming — une seule route same-origin par sport", () => {
  // Depuis le correctif « aucun appel direct depuis le navigateur vers une API
  // externe » : le client n'interroge QUE /api/<sport>/matches. La cascade de sources
  // (source principale puis source de secours) vit côté serveur, dans la route, où
  // CORS ne s'applique pas et où la clé n'est pas exposée.
  function blumeRoute(payload) {
    return { ok: true, json: () => Promise.resolve(payload) };
  }

  test("AUCUN appel vers un domaine externe : le navigateur ne sort jamais de l'origine", async () => {
    const seen = [];
    const fetchImpl = jest.fn((url) => {
      seen.push(String(url));
      return blumeRoute({ competitions: [] });
    });
    for (const sport of ["football", "basketball", "tennis"]) {
      await loadUpcoming(sport, { fetchImpl, now: NOW });
    }
    expect(seen).toEqual(["/api/football/matches", "/api/basketball/matches", "/api/tennis/matches"]);
    // Toute URL absolue serait un appel hors origine — interdit.
    expect(seen.every((u) => u.startsWith("/api/"))).toBe(true);
  });

  test("la route maison remplit la liste, déduplique et rapporte la couverture", async () => {
    const fetchImpl = jest.fn(() =>
      blumeRoute({
        competitions: [
          {
            code: "CL",
            matches: [
              { id: 99, status: "SCHEDULED", utcDate: inHours(5), competition: { name: "UEFA Champions League", area: "Europe" }, homeTeam: { name: "Real Madrid" }, awayTeam: { name: "Manchester City" } },
              // Même match renvoyé deux fois par la cascade serveur : une seule carte.
              { id: 98, status: "SCHEDULED", utcDate: inHours(5), competition: { name: "UEFA Champions League" }, homeTeam: { name: "Real Madrid CF" }, awayTeam: { name: "Manchester City FC" } },
              { id: 100, status: "SCHEDULED", utcDate: inHours(30), competition: { name: "LaLiga", area: "Espagne" }, homeTeam: { name: "Sevilla" }, awayTeam: { name: "Betis" } },
              { id: 101, status: "SCHEDULED", utcDate: inHours(8), competition: { name: "Bhutan Premier League" }, homeTeam: { name: "Bhutan A" }, awayTeam: { name: "Bhutan B" } },
            ],
          },
        ],
        diagnostic: { source: "football-data.org", window: { from: "2026-08-05", to: "2026-08-12" }, received: 4 },
      })
    );

    const { days, coverage, allSourcesFailed, anySourceFailed } = await loadUpcoming("football", { fetchImpl, now: NOW });

    expect(allSourcesFailed).toBe(false);
    expect(anySourceFailed).toBe(false);
    expect(coverage.upcoming).toBe(3); // le doublon a bien fusionné
    expect(coverage.competitions).toBe(3);

    const total = days.reduce((n, d) => n + d.competitions.reduce((k, c) => k + c.matches.length, 0), 0);
    // Ce qui est groupé égale exactement ce qui a été retenu : aucun match perdu.
    expect(total).toBe(coverage.upcoming);
  });

  test("la route en panne : signalé explicitement, jamais confondu avec « aucun match »", async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error("hors service")));
    const { days, allSourcesFailed, anySourceFailed, errors } = await loadUpcoming("football", { fetchImpl, now: NOW });
    expect(days).toHaveLength(0);
    expect(allSourcesFailed).toBe(true);
    expect(anySourceFailed).toBe(true);
    expect(errors.blume).toMatch(/hors service/);
  });

  test("cascade serveur : une source secondaire en échec suffit à interdire « aucun match »", async () => {
    const fetchImpl = jest.fn(() =>
      blumeRoute({
        competitions: [],
        diagnostic: {
          source: "API-Basketball → SportScore (secours)",
          window: { from: "2026-08-05", to: "2026-08-12" },
          anySourceFailed: true,
          allSourcesFailed: false,
          sources: [
            { name: "API-Basketball", httpStatus: 200, received: 0, error: null },
            { name: "SportScore (secours)", httpStatus: null, received: 0, error: "Failed to fetch" },
          ],
        },
      })
    );
    const { allSourcesFailed, anySourceFailed, diagnostic } = await loadUpcoming("basketball", { fetchImpl, now: NOW });
    expect(allSourcesFailed).toBe(false);
    expect(anySourceFailed).toBe(true);
    // Le détail source par source de la cascade serveur est repris tel quel.
    expect(diagnostic.sources).toHaveLength(2);
    expect(diagnostic.sources[1].error).toBe("Failed to fetch");
  });

  test("tennis : plus aucun blocage écrit en dur — un match remonte normalement", async () => {
    const fetchImpl = jest.fn(() =>
      blumeRoute({
        competitions: [{ name: "US Open", matches: [{ id: 1, status: "SCHEDULED", utcDate: inHours(5), competition: { name: "US Open" }, homeTeam: { name: "Djokovic" }, awayTeam: { name: "Alcaraz" } }] }],
        diagnostic: { source: "SportScore", window: { from: "2026-08-05", to: "2026-08-12" }, received: 1 },
      })
    );

    const { days, coverage, allSourcesFailed } = await loadUpcoming("tennis", { fetchImpl, now: NOW });

    expect(allSourcesFailed).toBe(false);
    expect(coverage.upcoming).toBe(1);
    expect(days[0].competitions[0].competition).toBe("US Open");
  });

  test("écran vide : le diagnostic expose source, code HTTP et plage de dates", async () => {
    const fetchImpl = jest.fn(() =>
      blumeRoute({
        competitions: [],
        diagnostic: {
          source: "API-Basketball → SportScore (secours)",
          window: { from: "2026-08-05", to: "2026-08-12" },
          sources: [
            { name: "API-Basketball", httpStatus: 200, received: 0, error: null },
            { name: "SportScore (secours)", httpStatus: 200, received: 0, error: null },
          ],
        },
      })
    );
    const { days, diagnostic, allSourcesFailed, anySourceFailed } = await loadUpcoming("basketball", { fetchImpl, now: NOW });

    // Vide CONSTATÉ (toutes les sources ont répondu 200 avec 0), jamais décidé.
    expect(days).toHaveLength(0);
    expect(allSourcesFailed).toBe(false);
    expect(anySourceFailed).toBe(false);
    expect(diagnostic.sources.map((s) => s.name)).toEqual([
      "/api/basketball/matches → API-Basketball",
      "/api/basketball/matches → SportScore (secours)",
    ]);
    expect(diagnostic.sources.every((s) => s.httpStatus === 200)).toBe(true);
    expect(diagnostic.sources.every((s) => s.received === 0)).toBe(true);
    expect(diagnostic.window.from).toBe("2026-08-05");
    expect(diagnostic.window.to).toBe("2026-08-12");
  });
});
