const { liveMatches, upcomingByCompetition, finishedMatch, standingsByCompetition } = require("./fixtures");
const { COMPETITIONS } = require("../lib/competitions");
const { computePronostic, computeLivePronostic } = require("../lib/pronostic");
const { isBettableCompetitionName } = require("../lib/bettableFilter");

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
      const matchId = Number(params.get("matchId"));
      const live = liveMatches.find((m) => m.id === matchId);
      const competitionCode = params.get("competitionCode");
      const homeTeamId = params.get("homeTeamId");
      const awayTeamId = params.get("awayTeamId");
      const homeTeamName = params.get("homeTeamName") || "Équipe A";
      const awayTeamName = params.get("awayTeamName") || "Équipe B";

      const table = standingsByCompetition[competitionCode] || [];
      const homeRow = table.find((r) => String(r.team.id) === homeTeamId) || null;
      const awayRow = table.find((r) => String(r.team.id) === awayTeamId) || null;

      const result = live
        ? computeLivePronostic({
            homeRow, awayRow, homeTeamName, awayTeamName,
            currentHome: live.score.fullTime.home, currentAway: live.score.fullTime.away, minute: live.minute,
          })
        : computePronostic({ homeRow, awayRow, homeTeamName, awayTeamName });

      if (live) {
        result.matchStatus = live.status;
        result.matchMinute = live.minute;
        result.matchScore = live.score.fullTime;
      }
      // Non fournis par les fixtures de classement : valeurs réalistes fixes pour ces
      // deux champs annexes (coup d'envoi/stade/arbitre), sans lien avec le calcul.
      result.venue = "Emirates Stadium";
      result.referee = "Michael Oliver";
      return route.fulfill({ json: result });
    }

    return route.fulfill({ status: 404, json: { error: `Route non simulée : ${path}` } });
  });
}

module.exports = { installApiMocks };
