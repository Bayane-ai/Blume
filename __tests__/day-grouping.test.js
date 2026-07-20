/**
 * lib/dayGrouping.js — regroupement des matchs par jour calendaire (fuseau local),
 * pour la page "Matchs à venir" jour par jour.
 */
import { buildDayList, dayLabel, localDayKey, groupMatchesByDay, sortDayMatches } from "../lib/dayGrouping";

function at(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3600000).toISOString();
}

describe("buildDayList", () => {
  test("renvoie au moins 7 jours, en commençant par aujourd'hui", () => {
    const days = buildDayList();
    expect(days.length).toBeGreaterThanOrEqual(7);
    expect(days[0].label).toBe("Aujourd'hui");
    expect(days[1].label).toBe("Demain");
  });

  test("chaque jour a une clé distincte, dans l'ordre chronologique", () => {
    const days = buildDayList(7);
    const keys = days.map((d) => d.key);
    expect(new Set(keys).size).toBe(7);
    for (let i = 1; i < days.length; i++) {
      expect(days[i].date.getTime()).toBeGreaterThan(days[i - 1].date.getTime());
    }
  });
});

describe("dayLabel", () => {
  test('index 0 = "Aujourd\'hui", index 1 = "Demain"', () => {
    expect(dayLabel(new Date(), 0)).toBe("Aujourd'hui");
    expect(dayLabel(new Date(), 1)).toBe("Demain");
  });

  test('à partir de l\'index 2, un jour de semaine + date en toutes lettres (ex : "Mercredi 22 juillet")', () => {
    const date = new Date(2026, 6, 22); // 22 juillet 2026 (mois 0-indexé)
    const label = dayLabel(date, 2);
    expect(label).toMatch(/^[A-ZÉ][a-zéû]+ 22 juillet$/);
  });
});

describe("localDayKey", () => {
  test("deux dates du même jour calendaire (fuseau local) ont la même clé", () => {
    const morning = new Date(2026, 6, 22, 8, 0);
    const evening = new Date(2026, 6, 22, 23, 0);
    expect(localDayKey(morning)).toBe(localDayKey(evening));
  });

  test("deux dates de jours différents ont des clés différentes", () => {
    const day1 = new Date(2026, 6, 22, 23, 59);
    const day2 = new Date(2026, 6, 23, 0, 1);
    expect(localDayKey(day1)).not.toBe(localDayKey(day2));
  });
});

describe("groupMatchesByDay", () => {
  test("regroupe correctement des matchs répartis sur plusieurs jours", () => {
    const matches = [
      { id: 1, utcDate: at(2) }, // aujourd'hui
      { id: 2, utcDate: at(5) }, // aujourd'hui
      { id: 3, utcDate: at(26) }, // demain
    ];
    const groups = groupMatchesByDay(matches);
    expect(groups.size).toBe(2);
    const todayKey = localDayKey(new Date());
    expect(groups.get(todayKey)).toHaveLength(2);
  });

  test("ignore un match sans date de coup d'envoi exploitable, sans planter", () => {
    const matches = [{ id: 1, utcDate: null }, { id: 2, utcDate: at(1) }];
    const groups = groupMatchesByDay(matches);
    const total = [...groups.values()].reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(1);
  });
});

describe("sortDayMatches", () => {
  test("les matchs en direct passent avant les matchs à venir, quelle que soit l'heure", () => {
    const matches = [
      { id: 1, status: "SCHEDULED", utcDate: at(1) },
      { id: 2, status: "IN_PLAY", utcDate: at(-1) },
      { id: 3, status: "SCHEDULED", utcDate: at(0.5) },
      { id: 4, status: "PAUSED", utcDate: at(-2) },
    ];
    const sorted = sortDayMatches(matches);
    // Les deux matchs en direct (4, 2 — triés entre eux par heure de coup d'envoi
    // croissante) passent avant les deux matchs à venir (3, 1).
    expect(sorted.map((m) => m.id)).toEqual([4, 2, 3, 1]);
  });

  test("à statut égal, tri par heure de coup d'envoi croissante", () => {
    const matches = [
      { id: 1, status: "SCHEDULED", utcDate: at(6) },
      { id: 2, status: "SCHEDULED", utcDate: at(1) },
      { id: 3, status: "SCHEDULED", utcDate: at(3) },
    ];
    const sorted = sortDayMatches(matches);
    expect(sorted.map((m) => m.id)).toEqual([2, 3, 1]);
  });

  test("ne modifie pas le tableau d'origine", () => {
    const matches = [{ id: 1, status: "SCHEDULED", utcDate: at(2) }, { id: 2, status: "SCHEDULED", utcDate: at(1) }];
    const original = [...matches];
    sortDayMatches(matches);
    expect(matches).toEqual(original);
  });
});
