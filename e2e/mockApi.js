const { liveMatches, upcomingByCompetition, finishedMatch, standingsByCompetition } = require("./fixtures");
const { COMPETITIONS } = require("../lib/competitions");
const { computePronostic, computeLiveOutcome } = require("../lib/pronostic");
const { classifyOutcome, toPredictionSnapshot } = require("../lib/pronosticHistory");
const { verifyPredictionLines } = require("../lib/pronosticVerification");
const { isBettableCompetitionName } = require("../lib/bettableFilter");
const { buildProbableScorers } = require("../lib/probableScorers");

// Historique "Probabilités réussies/échouées" : le VRAI classifyOutcome de
// lib/pronosticHistory.js (pas une donnée recopiée) tranche chaque match ci-dessous —
// vérifie en conditions réelles (navigateur) que le bon badge atterrit sur le bon
// match, à partir d'un vrai pronostic calculé (computePronostic) et d'un score final
// choisi pour chaque scénario. `verification` (VRAI verifyPredictionLines, voir PROMPT
// "chaque ligne de pronostic doit porter un indicateur visuel") utilise `realStats:
// null` — aucune clé API-Football dans cet environnement E2E — ce qui exerce
// honnêtement le cas le plus courant en production actuelle : seules les lignes de
// buts (dérivées du vrai score final, toujours connu) restent vérifiables, le reste
// s'affiche "Indisponible", jamais un résultat inventé.
function historyFixtureItem({ matchId, homeRow, awayRow, homeTeamName, awayTeamName, matchDate, finalScore }) {
  const prediction = toPredictionSnapshot(computePronostic({ homeRow, awayRow, homeTeamName, awayTeamName }));
  const status = classifyOutcome(prediction, finalScore);
  const verification = verifyPredictionLines({ prediction, finalScore, realStats: null });
  return {
    match_id: String(matchId), home_team_name: homeTeamName, away_team_name: awayTeamName,
    match_date: matchDate, final_score: finalScore, status, prediction: { ...prediction, verification },
  };
}

function buildHistoryFixture() {
  const plTable = standingsByCompetition.PL;
  const arsenal = plTable.find((r) => r.team.id === 10);
  const chelsea = plTable.find((r) => r.team.id === 11);
  const pdTable = standingsByCompetition.PD;
  const realMadrid = pdTable.find((r) => r.team.id === 20);
  const barcelona = pdTable.find((r) => r.team.id === 21);

  const items = [
    // Arsenal, net favori du classement (voir standingsByCompetition.PL) : score qui
    // confirme que l'équipe favorite a bien gagné -> classé "success" (Bloc 3 : seul
    // le résultat de l'équipe favorite compte pour le badge global).
    historyFixtureItem({
      matchId: 901, homeRow: arsenal, awayRow: chelsea, homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: new Date(Date.now() - 1 * 24 * 3600000).toISOString(), finalScore: { home: 3, away: 0 },
    }),
    // Real Madrid vs Barcelone : score qui contredit l'équipe favorite attendue
    // (favori battu) -> classé "failure".
    historyFixtureItem({
      matchId: 902, homeRow: realMadrid, awayRow: barcelona, homeTeamName: "Real Madrid", awayTeamName: "FC Barcelona",
      matchDate: new Date(Date.now() - 2 * 24 * 3600000).toISOString(), finalScore: { home: 0, away: 3 },
    }),
    // Même affiche Arsenal-Chelsea, mais vieille de 6 jours : sert à vérifier que le
    // nettoyage à 5 jours (lib/pronosticHistory.js) l'exclut bien des deux listes.
    historyFixtureItem({
      matchId: 903, homeRow: arsenal, awayRow: chelsea, homeTeamName: "Arsenal FC", awayTeamName: "Chelsea FC",
      matchDate: new Date(Date.now() - 6 * 24 * 3600000).toISOString(), finalScore: { home: 2, away: 0 },
    }),
  ];

  // Reproduit ici le VRAI filtre à 5 jours de lib/pronosticHistory.js (cleanupExpired) :
  // le mock réseau ne passe jamais par le vrai code serveur, donc cette règle doit être
  // rejouée à la main pour que la vérification en navigateur ait un sens.
  const FIVE_DAYS_MS = 5 * 24 * 3600 * 1000;
  return items.filter((item) => Date.now() - new Date(item.match_date).getTime() <= FIVE_DAYS_MS);
}

// Vrais buteurs/passeurs (format football-data.org /scorers) pour les équipes des
// fixtures ci-dessus — sert à vérifier en conditions réelles (navigateur) que
// "Buteurs probables" et "Passes décisives probables" affichent de vraies données,
// propres à chaque équipe.
const scorersFixture = [
  { player: { name: "Bukayo Saka" }, team: { id: 10 }, goals: 12, assists: 6 },
  { player: { name: "Martin Ødegaard" }, team: { id: 10 }, goals: 4, assists: 9 },
  { player: { name: "Cole Palmer" }, team: { id: 11 }, goals: 15, assists: 7 },
  { player: { name: "Vinícius Júnior" }, team: { id: 20 }, goals: 18, assists: 8 },
  { player: { name: "Jude Bellingham" }, team: { id: 20 }, goals: 14, assists: 6 },
  { player: { name: "Robert Lewandowski" }, team: { id: 21 }, goals: 22, assists: 5 },
  { player: { name: "Raphinha" }, team: { id: 21 }, goals: 10, assists: 9 },
];

// Intercepte /api/* au niveau réseau (avant même que le serveur Next.js ne les
// reçoive) et rejoue des données réalistes — le vrai football-data.org est
// injoignable depuis cet environnement (voir historique de session). Le code
// applicatif réel (pages, composants) est testé sans modification.
async function installApiMocks(page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const params = url.searchParams;

    if (path === "/api/live-matches") {
      return route.fulfill({ json: { matches: liveMatches } });
    }

    if (path === "/api/matches") {
      // Reflète pages/api/matches.js : toute compétition réellement présente dans les
      // matchs apparaît (pas seulement celles de lib/competitions.js), sauf les
      // catégories jeunes/réserves/amateurs ("les matchs sur lesquels on peut parier",
      // voir lib/bettableFilter.js) — les compétitions majeures connues d'abord, dans
      // leur ordre habituel, les autres ensuite, triées alphabétiquement.
      const priorityCodes = COMPETITIONS.map((c) => c.code);
      const codes = Object.keys(upcomingByCompetition).filter(
        (code) => (upcomingByCompetition[code] || []).length > 0 && isBettableCompetitionName(upcomingByCompetition[code][0].competition.name)
      );
      const orderedCodes = [
        ...priorityCodes.filter((code) => codes.includes(code)),
        ...codes
          .filter((code) => !priorityCodes.includes(code))
          .sort((a, b) => upcomingByCompetition[a][0].competition.name.localeCompare(upcomingByCompetition[b][0].competition.name)),
      ];
      const competitions = orderedCodes.map((code) => {
        const known = COMPETITIONS.find((c) => c.code === code);
        const matches = upcomingByCompetition[code];
        return { code, name: known?.name || matches[0].competition.name, area: known?.area || "", matches };
      });
      return route.fulfill({ json: { competitions } });
    }

    if (path === "/api/competition-matches") {
      const code = params.get("code");
      const comp = COMPETITIONS.find((c) => c.code === code);
      if (!comp) return route.fulfill({ status: 400, json: { error: "Compétition inconnue" } });
      const view = params.get("view");
      const matches = view === "results" ? (code === "PL" ? [finishedMatch] : []) : upcomingByCompetition[code] || [];
      return route.fulfill({ json: { ...comp, matches } });
    }

    if (path === "/api/competition-standings") {
      const code = params.get("code");
      const comp = COMPETITIONS.find((c) => c.code === code);
      if (!comp) return route.fulfill({ status: 400, json: { error: "Compétition inconnue" } });
      return route.fulfill({ json: { ...comp, table: standingsByCompetition[code] || [] } });
    }

    if (path === "/api/news") {
      return route.fulfill({
        json: {
          articles: [
            {
              title: "Real Madrid officialise le transfert d'un grand attaquant",
              link: "https://example.com/news/major",
              summary: "Un transfert record qui bouscule le mercato de la Champions League.",
              source: "BBC Sport",
              publishedAt: new Date().toISOString(),
              image: "https://example.com/news/major.jpg",
            },
            {
              title: "Match amical de pré-saison entre deux clubs de deuxième division",
              link: "https://example.com/news/minor",
              summary: "Une rencontre sans grand enjeu avant la reprise du championnat.",
              source: "Sky Sports",
              publishedAt: new Date(Date.now() - 3600000).toISOString(),
              image: null,
            },
          ],
        },
      });
    }

    if (path === "/api/analyze") {
      // Appelle le VRAI moteur de pronostic (lib/pronostic.js) avec les vraies
      // statistiques du match (standingsByCompetition, ci-dessous) — comme le ferait
      // pages/api/analyze.js en production — plutôt qu'un pronostic générique
      // identique pour tous les matchs : nécessaire pour vérifier en conditions
      // réelles (navigateur) que chaque match a bien SES PROPRES chiffres (PROMPT 5).
      // Pronostics figés (correction demandée après coup) : computePronostic ne dépend
      // jamais du score/de la minute en direct, donc l'appeler à chaque requête (sans
      // persistance côté mock) reproduit déjà fidèlement le comportement figé attendu
      // — un match donné (mêmes homeRow/awayRow/noms) renvoie toujours EXACTEMENT le
      // même pronostic, quel que soit le score en direct au moment de l'appel.
      const matchId = Number(params.get("matchId"));
      const live = liveMatches.find((m) => m.id === matchId);
      // Bloc 4 (parcours vidéo) : "quand on appuie sur un match déjà terminé" —
      // reproduit ici, pour finishedMatch (voir e2e/fixtures.js), le VRAI calcul de
      // pages/api/analyze.js (classifyOutcome + verifyPredictionLines) pour que le
      // compte-rendu (components/MatchOutcomeRecap.js) soit vérifiable en conditions
      // réelles (navigateur), pas seulement en test unitaire.
      const finished = !live && finishedMatch.id === matchId ? finishedMatch : null;
      const competitionCode = params.get("competitionCode");
      const homeTeamId = params.get("homeTeamId");
      const awayTeamId = params.get("awayTeamId");
      const homeTeamName = params.get("homeTeamName") || "Équipe A";
      const awayTeamName = params.get("awayTeamName") || "Équipe B";

      const table = standingsByCompetition[competitionCode] || [];
      const homeRow = table.find((r) => String(r.team.id) === homeTeamId) || null;
      const awayRow = table.find((r) => String(r.team.id) === awayTeamId) || null;

      const result = computePronostic({ homeRow, awayRow, homeTeamName, awayTeamName });
      const isLive = Boolean(live && (live.status === "IN_PLAY" || live.status === "PAUSED"));
      result.live = isLive;

      if (live) {
        result.matchStatus = live.status;
        result.matchMinute = live.minute;
        result.matchScore = live.score.fullTime;
      } else if (finished) {
        result.matchStatus = finished.status;
        result.matchMinute = finished.minute;
        result.matchScore = finished.score.fullTime;
        result.historyStatus = classifyOutcome(result, finished.score.fullTime);
        result.verification = verifyPredictionLines({ prediction: result, finalScore: finished.score.fullTime, realStats: null });
      }
      // Retour en arrière partiel (demande explicite de l'utilisateur) : reproduit ici
      // le même recalcul que pages/api/analyze.js — probabilités/scores exacts/totaux
      // suivent le score/la minute en direct, le reste (Corners/Hors-jeu/Fautes/
      // Touches, tirs, cartons...) reste figé sur l'estimation pré-match.
      if (isLive) {
        const liveOutcome = computeLiveOutcome({
          lambdaHome: result.goals.expectedHome,
          lambdaAway: result.goals.expectedAway,
          currentHome: live.score.fullTime.home,
          currentAway: live.score.fullTime.away,
          minute: live.minute,
        });
        result.probabilities = liveOutcome.probabilities;
        result.correctScores = liveOutcome.correctScores;
        result.goals = liveOutcome.goals;
        result.markets = { ...result.markets, ...liveOutcome.markets };
      }
      // Non fournis par les fixtures de classement : valeurs réalistes fixes pour ces
      // deux champs annexes (coup d'envoi/stade/arbitre), sans lien avec le calcul.
      result.venue = "Emirates Stadium";
      result.referee = "Michael Oliver";
      // Vrais buteurs/passeurs (voir scorersFixture ci-dessus) : nécessaire pour
      // vérifier en conditions réelles que "Buteurs probables" et "Passes décisives
      // probables" affichent bien du contenu (pas seulement testé via Jest).
      result.probableScorers = buildProbableScorers(scorersFixture, homeTeamId, awayTeamId);
      // Pas de clé API-Football dans cet environnement E2E : honnêtement vide,
      // affiché comme "Indisponible" côté interface (voir components/CardsAndCorners.js).
      result.cardProneness = { home: [], away: [] };
      return route.fulfill({ json: result });
    }

    if (path === "/api/pronostic-history") {
      const status = params.get("status") === "failure" ? "failure" : "success";
      const items = buildHistoryFixture().filter((item) => item.status === status);
      return route.fulfill({ json: { items } });
    }

    return route.fulfill({ status: 404, json: { error: `Route non simulée : ${path}` } });
  });
}

module.exports = { installApiMocks };
