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

describe("loadUpcoming — agrégation réelle des sources", () => {
  function ssPayload(matches) {
    return { ok: true, json: () => Promise.resolve({ matches }) };
  }

  test("fusionne SportScore et la source Blume, sans doublon, et rapporte la couverture", async () => {
    const fetchImpl = jest.fn((url) => {
      if (String(url).includes("sportscore")) {
        return Promise.resolve(ssPayload([
          { id: 1, home_team: { name: "Real Madrid" }, away_team: { name: "Manchester City" }, league: { name: "UEFA Champions League" }, start_at: inHours(5), status: "not_started" },
          { id: 2, home_team: { name: "Bhutan A" }, away_team: { name: "Bhutan B" }, league: { name: "Bhutan Premier League" }, start_at: inHours(8), status: "not_started" },
        ]));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          competitions: [{
            code: "CL",
            matches: [
              // Doublon du 1er match SportScore.
              { id: 99, status: "SCHEDULED", utcDate: inHours(5), competition: { name: "UEFA Champions League", area: "Europe" }, homeTeam: { name: "Real Madrid" }, awayTeam: { name: "Manchester City" } },
              { id: 100, status: "SCHEDULED", utcDate: inHours(30), competition: { name: "LaLiga", area: "Espagne" }, homeTeam: { name: "Sevilla" }, awayTeam: { name: "Betis" } },
            ],
          }],
        }),
      });
    });

    const { days, coverage, allSourcesFailed } = await loadUpcoming("football", { fetchImpl, now: NOW });

    expect(allSourcesFailed).toBe(false);
    expect(coverage.fromSportScore).toBe(2);
    expect(coverage.fromBlume).toBe(2);
    expect(coverage.afterDedupe).toBe(3); // le doublon a bien fusionné
    expect(coverage.upcoming).toBe(3);
    expect(coverage.competitions).toBe(3);

    const total = days.reduce((n, d) => n + d.competitions.reduce((k, c) => k + c.matches.length, 0), 0);
    // Ce qui est groupé égale exactement ce qui a été retenu : aucun match perdu.
    expect(total).toBe(coverage.upcoming);
  });

  test("une seule source en panne : la liste se remplit quand même, l'erreur est rapportée", async () => {
    const fetchImpl = jest.fn((url) =>
      String(url).includes("sportscore")
        ? Promise.reject(new Error("CORS"))
        : Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ competitions: [{ matches: [{ id: 1, status: "SCHEDULED", utcDate: inHours(5), competition: { name: "LaLiga" }, homeTeam: { name: "A" }, awayTeam: { name: "B" } }] }] }),
          })
    );
    const { days, errors, allSourcesFailed } = await loadUpcoming("football", { fetchImpl, now: NOW });
    expect(days).toHaveLength(1);
    expect(errors.sportScore).toMatch(/CORS/);
    expect(allSourcesFailed).toBe(false);
  });

  test("les deux sources en panne : signalé explicitement, jamais confondu avec « aucun match »", async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error("hors service")));
    const { days, allSourcesFailed, errors } = await loadUpcoming("football", { fetchImpl, now: NOW });
    expect(days).toHaveLength(0);
    expect(allSourcesFailed).toBe(true);
    expect(errors.sportScore).toMatch(/hors service/);
    expect(errors.blume).toMatch(/hors service/);
  });

  test("chaque sport interroge bien SA route maison, jamais celle d'un autre sport", async () => {
    const seen = [];
    const fetchImpl = jest.fn((url) => {
      const u = String(url);
      if (u.includes("sportscore")) return Promise.reject(new Error("x"));
      seen.push(u);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ competitions: [] }) });
    });
    for (const sport of ["football", "basketball", "tennis"]) {
      await loadUpcoming(sport, { fetchImpl, now: NOW });
    }
    expect(seen).toEqual(["/api/matches", "/api/basketball/matches", "/api/tennis/matches"]);
  });

  test("tennis sans calendrier (plan gratuit) : signalé comme non supporté, jamais comme une erreur", async () => {
    const fetchImpl = jest.fn((url) =>
      String(url).includes("sportscore")
        ? Promise.reject(new Error("x"))
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ unsupported: true, message: "Pas de calendrier tennis." }) })
    );
    const { unsupported, allSourcesFailed } = await loadUpcoming("tennis", { fetchImpl, now: NOW });
    expect(unsupported).toBe("Pas de calendrier tennis.");
    expect(allSourcesFailed).toBe(false);
  });
});
