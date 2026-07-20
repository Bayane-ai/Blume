// Données réalistes pour le parcours E2E — rejouées via l'interception réseau de
// Playwright (page.route), donc /api/* renvoie ces données sans jamais toucher au
// vrai football-data.org (injoignable depuis cet environnement). Aucune statistique
// de "précision IA" n'est incluse : Blume n'a pas de mesure réelle de précision, et
// n'en invente pas (voir lib/pronostic.js — modèle statistique de Poisson, pas une IA).

const pronostic = (overrides = {}) => ({
  available: true,
  live: false,
  home: { name: "Arsenal FC", position: 3, points: 55, form: "WWDLW", source: "classement" },
  away: { name: "Chelsea FC", position: 7, points: 44, form: "LWDDL", source: "classement" },
  probabilities: { home: 48.2, draw: 26.1, away: 25.7 },
  goals: { expectedHome: 1.6, expectedAway: 1.1, expectedTotal: 2.7, over25: 54.3, under25: 45.7, bttsYes: 58.9, bttsNo: 41.1 },
  extraStats: {
    corners: { home: 6, away: 4, total: 10 },
    shots: { home: 14, away: 10, total: 24 },
    cards: { home: 2, away: 3, total: 5 },
  },
  correctScores: [
    { score: "1-1", probability: 10.8 }, { score: "2-1", probability: 9.8 }, { score: "1-0", probability: 9.5 },
  ],
  note: "Estimation statistique (modèle de Poisson) basée sur les buts marqués/encaissés au classement — pas une IA.",
  statsNote: "Corners, tirs et cartons ne sont pas fournis par l'API (plan gratuit) : ce sont des estimations statistiques.",
  ...overrides,
});

const liveMatches = [
  {
    id: 101, status: "IN_PLAY", minute: 32, utcDate: new Date().toISOString(), matchday: 25,
    competition: { code: "PL", name: "Premier League", emblem: "" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
    score: { fullTime: { home: 1, away: 0 } },
    pronostic: pronostic({ live: true, minute: 32, currentScore: { home: 1, away: 0 } }),
  },
  {
    id: 102, status: "IN_PLAY", minute: 75, utcDate: new Date().toISOString(), matchday: 20,
    competition: { code: "PD", name: "LaLiga", emblem: "" },
    homeTeam: { id: 20, name: "Real Madrid", crest: "" },
    awayTeam: { id: 21, name: "FC Barcelona", crest: "" },
    score: { fullTime: { home: 2, away: 2 } },
    pronostic: pronostic({
      live: true, minute: 75, currentScore: { home: 2, away: 2 },
      home: { name: "Real Madrid", position: 1, points: 70, form: "WWWDW", source: "classement" },
      away: { name: "FC Barcelona", position: 2, points: 65, form: "WWDWW", source: "classement" },
    }),
  },
  // Compétition hors Europe (Brésil) : sert à vérifier que "Matchs en ligne" affiche
  // bien des matchs de compétitions variées du monde entier, pas seulement les
  // grandes ligues européennes.
  {
    id: 103, status: "IN_PLAY", minute: 58, utcDate: new Date().toISOString(), matchday: 15,
    competition: { code: "BSA", name: "Campeonato Brasileiro Série A", emblem: "" },
    homeTeam: { id: 50, name: "Flamengo", crest: "" },
    awayTeam: { id: 51, name: "Palmeiras", crest: "" },
    score: { fullTime: { home: 1, away: 1 } },
    pronostic: pronostic({
      live: true, minute: 58, currentScore: { home: 1, away: 1 },
      home: { name: "Flamengo", position: 1, points: 40, form: "WWDWW", source: "classement" },
      away: { name: "Palmeiras", position: 2, points: 38, form: "WDWWL", source: "classement" },
    }),
  },
];

function upcomingMatch(id, code, name, home, away, hoursFromNow, matchday) {
  return {
    id, status: "SCHEDULED", minute: null, matchday,
    utcDate: new Date(Date.now() + hoursFromNow * 3600000).toISOString(),
    competition: { code, name, emblem: "" },
    homeTeam: { id: home.id, name: home.name, crest: "" },
    awayTeam: { id: away.id, name: away.name, crest: "" },
    score: { fullTime: { home: null, away: null } },
    pronostic: pronostic({
      home: { name: home.name, position: 4, points: 40, form: "WDLWD", source: "classement" },
      away: { name: away.name, position: 6, points: 35, form: "DLWDL", source: "classement" },
    }),
  };
}

const upcomingByCompetition = {
  PL: [
    upcomingMatch(201, "PL", "Premier League", { id: 12, name: "Liverpool FC" }, { id: 13, name: "Manchester City FC" }, 5, 27),
    upcomingMatch(204, "PL", "Premier League", { id: 14, name: "Newcastle United FC" }, { id: 15, name: "Aston Villa FC" }, 6, 27),
  ],
  CL: [upcomingMatch(202, "CL", "Ligue des Champions", { id: 30, name: "Bayern Munich" }, { id: 31, name: "Paris Saint-Germain" }, 26, 5)],
  // Coupe du Monde : pas de champ `matchday` exploitable (phase à élimination directe) —
  // sert à vérifier qu'aucun carrousel de journées vide ne s'affiche pour cette compétition.
  WC: [upcomingMatch(203, "WC", "Coupe du Monde", { id: 40, name: "France" }, { id: 41, name: "Brazil" }, 50, undefined)],
  // Compétition volontairement ABSENTE de lib/competitions.js (ni grande ligue
  // européenne, ni dans la liste des compétitions majeures connues) : sert à vérifier
  // que "Matchs à venir" affiche bien TOUTE compétition réelle renvoyée par l'API,
  // fédérations sud-américaines et catégories jeunes comprises, sans filtre ni exception.
  CLI: [upcomingMatch(205, "CLI", "Copa Libertadores", { id: 60, name: "Boca Juniors" }, { id: 61, name: "River Plate" }, 10, undefined)],
  U20WC: [upcomingMatch(206, "U20WC", "Coupe du Monde U20", { id: 70, name: "Argentine U20" }, { id: 71, name: "Nigeria U20" }, 30, undefined)],
};

const finishedMatch = {
  id: 301, status: "FINISHED", minute: 90, utcDate: new Date(Date.now() - 2 * 24 * 3600000).toISOString(),
  competition: { code: "PL", name: "Premier League", emblem: "" },
  homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
  awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
  score: { fullTime: { home: 3, away: 1 } },
  pronostic: pronostic(),
};

const standingsByCompetition = {
  PL: [
    { position: 1, points: 55, playedGames: 20, won: 17, draw: 4, lost: 0, goalsFor: 45, goalsAgainst: 15, form: "WWDLW", team: { id: 10, name: "Arsenal FC", crest: "" } },
    { position: 2, points: 48, playedGames: 20, won: 14, draw: 6, lost: 0, goalsFor: 40, goalsAgainst: 18, form: "LWDDL", team: { id: 11, name: "Chelsea FC", crest: "" } },
    { position: 3, points: 40, playedGames: 20, won: 12, draw: 4, lost: 4, goalsFor: 35, goalsAgainst: 22, form: "WDLWD", team: { id: 12, name: "Liverpool FC", crest: "" } },
    { position: 4, points: 38, playedGames: 20, won: 11, draw: 5, lost: 4, goalsFor: 33, goalsAgainst: 24, form: "DLWDL", team: { id: 13, name: "Manchester City FC", crest: "" } },
  ],
  PD: [
    { position: 1, points: 70, playedGames: 25, won: 22, draw: 4, lost: 0, goalsFor: 60, goalsAgainst: 15, form: "WWWDW", team: { id: 20, name: "Real Madrid", crest: "" } },
    { position: 2, points: 65, playedGames: 25, won: 20, draw: 5, lost: 0, goalsFor: 58, goalsAgainst: 20, form: "WWDWW", team: { id: 21, name: "FC Barcelona", crest: "" } },
  ],
  CL: [
    { position: 1, points: 18, playedGames: 8, won: 6, draw: 0, lost: 2, goalsFor: 20, goalsAgainst: 8, form: "WWLWW", team: { id: 30, name: "Bayern Munich", crest: "" } },
    { position: 2, points: 15, playedGames: 8, won: 5, draw: 0, lost: 3, goalsFor: 18, goalsAgainst: 12, form: "LWWLW", team: { id: 31, name: "Paris Saint-Germain", crest: "" } },
  ],
  WC: [], // pas de classement structuré (phase à élimination directe) : cas "Indisponible" à vérifier
  BSA: [
    { position: 1, points: 40, playedGames: 15, won: 12, draw: 4, lost: 0, goalsFor: 32, goalsAgainst: 10, form: "WWDWW", team: { id: 50, name: "Flamengo", crest: "" } },
    { position: 2, points: 38, playedGames: 15, won: 11, draw: 5, lost: 0, goalsFor: 30, goalsAgainst: 12, form: "WDWWL", team: { id: 51, name: "Palmeiras", crest: "" } },
  ],
};

module.exports = { pronostic, liveMatches, upcomingByCompetition, finishedMatch, standingsByCompetition };
