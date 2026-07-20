/**
 * lib/pronostic.js — la force d'attaque/défense de chaque équipe utilise en priorité
 * sa vraie moyenne de buts À CE LIEU précis (domicile pour l'équipe qui reçoit,
 * extérieur pour celle qui se déplace), calculée à partir de ses derniers matchs
 * réellement joués (lib/teamForm.js) — plus un facteur d'avantage du terrain
 * générique appliqué à une moyenne mélangée. Le facteur générique ne sert plus que de
 * repli quand l'équipe n'a pas assez de matchs récents à ce lieu précis.
 */
import { computePronostic } from "../lib/pronostic";

function venueRow({ id, goalsFor, goalsAgainst, playedGames, homeGoalsFor, homeGoalsAgainst, homePlayedGames, awayGoalsFor, awayGoalsAgainst, awayPlayedGames }) {
  return {
    position: 5, points: 30, form: null,
    playedGames, goalsFor, goalsAgainst,
    homeGoalsFor, homeGoalsAgainst, homePlayedGames,
    awayGoalsFor, awayGoalsAgainst, awayPlayedGames,
    team: { id },
  };
}

test("une équipe qui marque beaucoup à domicile mais peu à l'extérieur (profil réel asymétrique) obtient un nombre de buts attendu différent selon qu'elle joue à domicile ou à l'extérieur", () => {
  // Même équipe, mêmes stats globales (10 matchs, 20 buts marqués = 2/match en
  // moyenne), mais un vrai profil très asymétrique : forte à domicile, famélique à
  // l'extérieur — un modèle basé sur la seule moyenne globale ne verrait pas cette
  // différence, un modèle basé sur le vrai lieu, si.
  const asymmetricTeam = (id) => venueRow({
    id, goalsFor: 20, goalsAgainst: 10, playedGames: 10,
    homeGoalsFor: 18, homeGoalsAgainst: 2, homePlayedGames: 5, // 3,6 buts/match à domicile
    awayGoalsFor: 2, awayGoalsAgainst: 8, awayPlayedGames: 5, // 0,4 but/match à l'extérieur
  });
  const neutralOpponent = venueRow({
    id: 99, goalsFor: 15, goalsAgainst: 15, playedGames: 10,
    homeGoalsFor: 8, homeGoalsAgainst: 7, homePlayedGames: 5,
    awayGoalsFor: 7, awayGoalsAgainst: 8, awayPlayedGames: 5,
  });

  const playingAtHome = computePronostic({
    homeRow: asymmetricTeam(1), awayRow: neutralOpponent, homeTeamName: "Asymétrique", awayTeamName: "Neutre",
  });
  const playingAway = computePronostic({
    homeRow: neutralOpponent, awayRow: asymmetricTeam(1), homeTeamName: "Neutre", awayTeamName: "Asymétrique",
  });

  // À domicile, l'équipe asymétrique doit avoir un nombre de buts attendu nettement
  // plus élevé qu'à l'extérieur — reflet direct de son vrai profil par lieu, pas de sa
  // moyenne globale (qui, elle, resterait identique dans les deux cas).
  expect(playingAtHome.goals.expectedHome).toBeGreaterThan(playingAway.goals.expectedAway * 2);
});

test("avec un échantillon insuffisant de matchs à ce lieu (moins de 3), le modèle se rabat sur la moyenne globale + facteur d'avantage du terrain générique", () => {
  // Une seule victoire écrasante à domicile (5-0) dans l'échantillon récent : pas
  // assez fiable pour servir de moyenne "domicile" telle quelle.
  const thinHomeSample = venueRow({
    id: 1, goalsFor: 8, goalsAgainst: 6, playedGames: 5,
    homeGoalsFor: 5, homeGoalsAgainst: 0, homePlayedGames: 1, // échantillon insuffisant
    awayGoalsFor: 3, awayGoalsAgainst: 6, awayPlayedGames: 4,
  });
  const opponent = venueRow({
    id: 2, goalsFor: 15, goalsAgainst: 15, playedGames: 10,
    homeGoalsFor: 8, homeGoalsAgainst: 7, homePlayedGames: 5,
    awayGoalsFor: 7, awayGoalsAgainst: 8, awayPlayedGames: 5,
  });

  const result = computePronostic({ homeRow: thinHomeSample, awayRow: opponent, homeTeamName: "A", awayTeamName: "B" });

  // Le repli utilise goalsFor/playedGames globaux (8/5 = 1,6) avec le facteur
  // générique (×1,1), jamais la moyenne "domicile" à un seul match (5 buts) prise
  // telle quelle — qui aurait donné un nombre de buts attendu bien plus extrême.
  expect(result.goals.expectedHome).toBeLessThan(3);
});

test("une équipe forte spécifiquement à domicile face à un adversaire neutre ressort favorite quand elle reçoit — le vrai profil par lieu pèse dans la probabilité, pas seulement dans les buts bruts", () => {
  const strongAtHome = venueRow({
    id: 1, goalsFor: 20, goalsAgainst: 16, playedGames: 10,
    homeGoalsFor: 16, homeGoalsAgainst: 4, homePlayedGames: 5, // 3,2 buts marqués / 0,8 encaissé à domicile
    awayGoalsFor: 4, awayGoalsAgainst: 12, awayPlayedGames: 5,
  });
  const neutralOpponent = venueRow({
    id: 2, goalsFor: 16, goalsAgainst: 16, playedGames: 10,
    homeGoalsFor: 8, homeGoalsAgainst: 8, homePlayedGames: 5,
    awayGoalsFor: 8, awayGoalsAgainst: 8, awayPlayedGames: 5,
  });

  const result = computePronostic({
    homeRow: strongAtHome, awayRow: neutralOpponent, homeTeamName: "ForteADomicile", awayTeamName: "Neutre",
  });

  expect(result.probabilities.home).toBeGreaterThan(50);
  expect(result.goals.expectedHome).toBeGreaterThan(result.goals.expectedAway);
});
