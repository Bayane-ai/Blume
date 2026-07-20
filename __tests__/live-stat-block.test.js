/**
 * lib/pronostic.js — buildMatchStats : les 4 blocs "Corners / Hors-jeu / Fautes /
 * Touches" (voir components/LiveStatBlock.js). Chaque bloc a la même structure (Total
 * match, Total 1, Total 2, ligne "mi-temps" qui bascule automatiquement) et la même
 * logique : Total match/1/2 recalculés en direct à partir du vrai décompte observé
 * (API-Football, quand disponible — corners/hors-jeu/fautes seulement, jamais les
 * touches), la ligne mi-temps basculant de "1ère" à "2ème" selon le statut réel.
 */
import { computePronostic, computeLivePronostic } from "../lib/pronostic";

function row({ id, goalsFor, goalsAgainst, playedGames = 20 }) {
  return { position: 5, points: 30, form: null, playedGames, goalsFor, goalsAgainst, team: { id } };
}

function baseTeams() {
  return {
    homeRow: row({ id: 1, goalsFor: 45, goalsAgainst: 20 }),
    awayRow: row({ id: 2, goalsFor: 30, goalsAgainst: 28 }),
    homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
  };
}

const BLOCKS = ["corners", "offsides", "fouls", "throwIns"];

test("les 4 blocs sont présents, chacun avec Total match/1/2 en Plus/Moins de X,5 et une ligne mi-temps", () => {
  const pronostic = computePronostic(baseTeams());
  expect(pronostic.matchStats).toBeDefined();
  for (const key of BLOCKS) {
    const block = pronostic.matchStats[key];
    for (const market of [block.total, block.home, block.away, block.half.market]) {
      expect(market.side).toMatch(/^Plus|Moins$/);
      expect(market.line % 1).toBeCloseTo(0.5, 5);
    }
  }
});

test("avant le match, la ligne mi-temps affiche \"1ère mi-temps\" pour les 4 blocs", () => {
  const pronostic = computePronostic(baseTeams());
  for (const key of BLOCKS) {
    expect(pronostic.matchStats[key].half.label).toBe("1ère mi-temps");
  }
});

test("en 1ère mi-temps (IN_PLAY, minute <= 45), la ligne mi-temps reste \"1ère mi-temps\"", () => {
  const live = computeLivePronostic({ ...baseTeams(), currentHome: 0, currentAway: 0, minute: 30, status: "IN_PLAY" });
  for (const key of BLOCKS) {
    expect(live.matchStats[key].half.label).toBe("1ère mi-temps");
  }
});

test("à la pause (statut PAUSED), la ligne mi-temps bascule sur \"2ème mi-temps\"", () => {
  const live = computeLivePronostic({ ...baseTeams(), currentHome: 1, currentAway: 0, minute: 45, status: "PAUSED" });
  for (const key of BLOCKS) {
    expect(live.matchStats[key].half.label).toBe("2ème mi-temps");
  }
});

test("en 2ème mi-temps (IN_PLAY, minute > 45), la ligne mi-temps est \"2ème mi-temps\"", () => {
  const live = computeLivePronostic({ ...baseTeams(), currentHome: 1, currentAway: 1, minute: 70, status: "IN_PLAY" });
  for (const key of BLOCKS) {
    expect(live.matchStats[key].half.label).toBe("2ème mi-temps");
  }
});

test("le basculement est automatique : rejouer avec un statut/minute différents change le label sans autre action", () => {
  const firstHalf = computeLivePronostic({ ...baseTeams(), currentHome: 0, currentAway: 0, minute: 10, status: "IN_PLAY" });
  const secondHalf = computeLivePronostic({ ...baseTeams(), currentHome: 1, currentAway: 0, minute: 55, status: "IN_PLAY" });
  expect(firstHalf.matchStats.corners.half.label).toBe("1ère mi-temps");
  expect(secondHalf.matchStats.corners.half.label).toBe("2ème mi-temps");
});

test("un vrai rythme de corners plus élevé que prévu fait monter le Total match, pas seulement rester figé sur l'estimation pré-match", () => {
  const teams = baseTeams();
  const preMatch = computePronostic(teams);
  const preMatchTotal = preMatch.matchStats.corners.total.line;

  // Rythme réel très supérieur à la moyenne (beaucoup de corners très tôt dans le
  // match) : le total projeté doit monter au-dessus de l'estimation pré-match.
  const hotMatch = computeLivePronostic({
    ...teams, currentHome: 0, currentAway: 0, minute: 20, status: "IN_PLAY",
    liveRealStats: { corners: { home: 7, away: 6 }, offsides: { home: 0, away: 0 }, fouls: { home: 0, away: 0 } },
  });
  expect(hotMatch.matchStats.corners.total.line).toBeGreaterThan(preMatchTotal);

  // Rythme réel très inférieur à la moyenne (quasi aucun corner) : le total projeté
  // doit baisser sous l'estimation pré-match.
  const quietMatch = computeLivePronostic({
    ...teams, currentHome: 0, currentAway: 0, minute: 70, status: "IN_PLAY",
    liveRealStats: { corners: { home: 0, away: 1 }, offsides: { home: 0, away: 0 }, fouls: { home: 0, away: 0 } },
  });
  expect(quietMatch.matchStats.corners.total.line).toBeLessThan(preMatchTotal);
});

test("sans donnée réelle (liveRealStats absent), le Total match reste égal à l'estimation pré-match — jamais une valeur qui bouge sans raison", () => {
  const teams = baseTeams();
  const preMatch = computePronostic(teams);
  const live = computeLivePronostic({ ...teams, currentHome: 1, currentAway: 0, minute: 60, status: "IN_PLAY" });
  for (const key of BLOCKS) {
    expect(live.matchStats[key].total.line).toBe(preMatch.matchStats[key].total.line);
    expect(live.matchStats[key].total.side).toBe(preMatch.matchStats[key].total.side);
  }
});

test("les touches (throwIns) ne bougent jamais avec un vrai décompte, même quand corners/hors-jeu/fautes en reçoivent un (aucune source réelle pour les touches)", () => {
  const teams = baseTeams();
  const preMatch = computePronostic(teams);
  const live = computeLivePronostic({
    ...teams, currentHome: 0, currentAway: 0, minute: 30, status: "IN_PLAY",
    liveRealStats: {
      corners: { home: 8, away: 7 }, offsides: { home: 4, away: 3 }, fouls: { home: 6, away: 5 },
    },
  });
  expect(live.matchStats.throwIns.total.line).toBe(preMatch.matchStats.throwIns.total.line);
  expect(live.matchStats.throwIns.total.side).toBe(preMatch.matchStats.throwIns.total.side);
});

test("deux matchs différents affichent des lignes différentes pour les 4 blocs — jamais recopiées d'un match à l'autre", () => {
  const m1 = computePronostic(baseTeams());
  const m2 = computePronostic({
    homeRow: row({ id: 3, goalsFor: 15, goalsAgainst: 40 }),
    awayRow: row({ id: 4, goalsFor: 40, goalsAgainst: 15 }),
    homeTeamName: "Défense A", awayTeamName: "Attaque B",
  });

  for (const key of BLOCKS) {
    const fingerprint = (p) => JSON.stringify(p.matchStats[key]);
    expect(fingerprint(m1)).not.toBe(fingerprint(m2));
  }
});
