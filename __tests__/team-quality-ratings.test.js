/**
 * lib/teamQualityRatings.js — PROMPT 1 : notes de qualité 0-100 par secteur (attaque,
 * défense, discipline, rythme) + note globale, par PERCENTILE RÉEL parmi les autres
 * équipes déjà profilées de la même compétition — jamais une échelle absolue codée en
 * dur.
 */
import { computeQualityRatings, refreshTeamQualityRatings } from "../lib/teamQualityRatings";

function field(value, { estimated = false } = {}) {
  return value == null
    ? { value: null, estimated: true, sampleSize: 0, available: false }
    : { value, estimated, sampleSize: 5, available: true };
}

function overall(overrides = {}) {
  return {
    goalsFor: field(1.5), shotsOnTarget: field(6), conversionRate: field(0.2),
    goalsAgainst: field(1.2), cleanSheetRate: field(0.3),
    yellowCards: field(2), redCards: field(0.1), foulsCommitted: field(10),
    cornersFor: field(5), shots: field(13), possession: field(50),
    ...overrides,
  };
}

describe("computeQualityRatings — pure, percentile réel parmi des pairs déjà fournis", () => {
  test("une équipe nettement au-dessus de ses pairs sur l'attaque obtient une note d'attaque élevée", () => {
    const strongAttack = overall({ goalsFor: field(3.5), shotsOnTarget: field(10), conversionRate: field(0.4) });
    const peers = [
      overall({ goalsFor: field(1.0), shotsOnTarget: field(4), conversionRate: field(0.1) }),
      overall({ goalsFor: field(1.2), shotsOnTarget: field(5), conversionRate: field(0.12) }),
      overall({ goalsFor: field(0.8), shotsOnTarget: field(3), conversionRate: field(0.08) }),
    ];
    const ratings = computeQualityRatings(strongAttack, peers);
    expect(ratings.attack.available).toBe(true);
    expect(ratings.attack.value).toBeGreaterThan(80);
  });

  test("une équipe nettement en dessous de ses pairs sur l'attaque obtient une note d'attaque basse", () => {
    const weakAttack = overall({ goalsFor: field(0.3), shotsOnTarget: field(2), conversionRate: field(0.05) });
    const peers = [
      overall({ goalsFor: field(2.0), shotsOnTarget: field(8) }),
      overall({ goalsFor: field(2.2), shotsOnTarget: field(9) }),
      overall({ goalsFor: field(1.8), shotsOnTarget: field(7) }),
    ];
    const ratings = computeQualityRatings(weakAttack, peers);
    expect(ratings.attack.value).toBeLessThan(20);
  });

  test("la défense est INVERSÉE : moins de buts encaissés que les pairs -> note de défense élevée", () => {
    const strongDefense = overall({ goalsAgainst: field(0.4), cleanSheetRate: field(0.6) });
    const peers = [
      overall({ goalsAgainst: field(1.5), cleanSheetRate: field(0.1) }),
      overall({ goalsAgainst: field(1.8), cleanSheetRate: field(0.05) }),
      overall({ goalsAgainst: field(2.0), cleanSheetRate: field(0.0) }),
    ];
    const ratings = computeQualityRatings(strongDefense, peers);
    expect(ratings.defense.value).toBeGreaterThan(80);
  });

  test("la discipline est INVERSÉE : plus de cartons/fautes que les pairs -> note de discipline basse", () => {
    const badDiscipline = overall({ yellowCards: field(4), redCards: field(0.4), foulsCommitted: field(18) });
    const peers = [
      overall({ yellowCards: field(1), redCards: field(0), foulsCommitted: field(8) }),
      overall({ yellowCards: field(1.2), redCards: field(0.02), foulsCommitted: field(9) }),
      overall({ yellowCards: field(0.8), redCards: field(0), foulsCommitted: field(7) }),
    ];
    const ratings = computeQualityRatings(badDiscipline, peers);
    expect(ratings.discipline.value).toBeLessThan(20);
  });

  test("moins de 3 pairs réels pour un champ : la note du secteur reste indisponible pour CE champ (jamais un percentile peu fiable)", () => {
    const team = overall();
    const peers = [overall(), overall()]; // seulement 2 pairs < MIN_PEERS_FOR_RATING (3)
    const ratings = computeQualityRatings(team, peers);
    for (const sector of ["attack", "defense", "discipline", "tempo"]) {
      expect(ratings[sector].available).toBe(false);
      expect(ratings[sector].value).toBeNull();
    }
    expect(ratings.overall.available).toBe(false);
  });

  test("aucun pair du tout : toutes les notes restent honnêtement indisponibles, jamais une valeur inventée", () => {
    const ratings = computeQualityRatings(overall(), []);
    expect(ratings.attack).toEqual({ value: null, available: false, basedOn: 0 });
    expect(ratings.overall).toEqual({ value: null, available: false });
  });

  test("un champ estimé (repli de compétition, pas une vraie mesure de CETTE équipe) n'entre jamais dans le calcul de sa propre note", () => {
    const teamWithEstimatedGoals = overall({ goalsFor: field(5, { estimated: true }) }); // valeur estimée, pas réelle
    const peers = [overall(), overall(), overall()];
    const ratings = computeQualityRatings(teamWithEstimatedGoals, peers);
    // L'attaque se base encore sur shotsOnTarget/conversionRate (réels), mais jamais
    // sur goalsFor (estimé) — la note reste donc disponible via les autres champs,
    // sans être faussée par la valeur estimée à 5.
    expect(ratings.attack.basedOn).toBeLessThanOrEqual(2);
  });

  test("la note globale est la moyenne des secteurs disponibles", () => {
    const balanced = overall();
    const peers = [
      overall({ goalsFor: field(0.5), goalsAgainst: field(2), yellowCards: field(4), cornersFor: field(2) }),
      overall({ goalsFor: field(0.6), goalsAgainst: field(2.2), yellowCards: field(4.2), cornersFor: field(2.2) }),
      overall({ goalsFor: field(0.4), goalsAgainst: field(1.9), yellowCards: field(3.8), cornersFor: field(1.8) }),
    ];
    const ratings = computeQualityRatings(balanced, peers);
    const sectorValues = ["attack", "defense", "discipline", "tempo"].map((s) => ratings[s].value).filter((v) => v != null);
    const expectedOverall = Math.round((sectorValues.reduce((a, b) => a + b, 0) / sectorValues.length) * 10) / 10;
    expect(ratings.overall.value).toBe(expectedOverall);
  });
});

describe("refreshTeamQualityRatings — orchestration Supabase (lecture des profils pairs de la même compétition)", () => {
  function makeSupabase(peerRows) {
    return {
      from: (table) => {
        if (table !== "team_stat_profiles") throw new Error(`table inattendue : ${table}`);
        return {
          select: () => ({
            eq: () => ({
              neq: () => Promise.resolve({ data: peerRows, error: null }),
            }),
          }),
        };
      },
    };
  }

  test("sans compétition connue, renvoie des notes indisponibles sans planter", async () => {
    const ratings = await refreshTeamQualityRatings(makeSupabase([]), null, "team-1", overall());
    expect(ratings.overall.available).toBe(false);
  });

  test("lit bien les profils des AUTRES équipes de la même compétition et calcule un percentile réel", async () => {
    const peerRows = [
      { overall: overall({ goalsFor: field(0.5), shotsOnTarget: field(2) }) },
      { overall: overall({ goalsFor: field(0.6), shotsOnTarget: field(2.5) }) },
      { overall: overall({ goalsFor: field(0.4), shotsOnTarget: field(1.8) }) },
    ];
    const strongTeam = overall({ goalsFor: field(3), shotsOnTarget: field(10) });
    const ratings = await refreshTeamQualityRatings(makeSupabase(peerRows), "PD", "strong-team", strongTeam);
    expect(ratings.attack.available).toBe(true);
    expect(ratings.attack.value).toBeGreaterThan(80);
  });

  test("erreur Supabase : notes indisponibles, ne lève jamais d'exception", async () => {
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ neq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }),
    };
    const ratings = await refreshTeamQualityRatings(supabase, "PD", "team-1", overall());
    expect(ratings.overall.available).toBe(false);
  });
});
