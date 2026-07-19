const { liveMatches, upcomingByCompetition, finishedMatch, standingsByCompetition, pronostic } = require("./fixtures");
const { COMPETITIONS } = require("../lib/competitions");

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
      const competitions = COMPETITIONS.map((c) => ({ ...c, matches: upcomingByCompetition[c.code] || [] }));
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

    if (path === "/api/analyze") {
      const matchId = Number(params.get("matchId"));
      const live = liveMatches.find((m) => m.id === matchId);
      const homeTeamName = params.get("homeTeamName") || "Équipe A";
      const awayTeamName = params.get("awayTeamName") || "Équipe B";
      const result = pronostic({
        live: !!live,
        home: { name: homeTeamName, position: 3, points: 55, form: "WWDLW", source: "classement" },
        away: { name: awayTeamName, position: 7, points: 44, form: "LWDDL", source: "classement" },
        venue: "Emirates Stadium",
        referee: "Michael Oliver",
      });
      if (live) {
        result.matchStatus = live.status;
        result.matchMinute = live.minute;
        result.matchScore = live.score.fullTime;
      }
      return route.fulfill({ json: result });
    }

    if (path === "/api/compare") {
      const homeTeamName = params.get("homeTeamName") || "Équipe A";
      const awayTeamName = params.get("awayTeamName") || "Équipe B";
      return route.fulfill({
        json: pronostic({
          home: { name: homeTeamName, position: 3, points: 55, form: "WWDLW", source: "classement" },
          away: { name: awayTeamName, position: 7, points: 44, form: "LWDDL", source: "classement" },
        }),
      });
    }

    return route.fulfill({ status: 404, json: { error: `Route non simulée : ${path}` } });
  });
}

module.exports = { installApiMocks };
