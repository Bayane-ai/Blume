/**
 * lib/espnSoccer.js — source des deux nouveaux widgets "compétitions spécifiques" /
 * "tous les clubs" (voir components/ExternalMatchesWidget.js) : API ESPN publique,
 * appelée directement depuis le navigateur (pas de route /api de Blume, pas de clé).
 * Doit rester honnête (jamais de match inventé) et ne jamais planter, quelle que soit
 * la forme exacte de la réponse.
 */
import { mapEspnEventToMatch, fetchLeagueScoreboard, getLeagueMatches, LEAGUE_SLUGS } from "../lib/espnSoccer";

function espnEvent(overrides = {}) {
  return {
    id: "401598010",
    date: "2026-08-10T18:00:00Z",
    competitions: [
      {
        date: "2026-08-10T18:00:00Z",
        status: { displayClock: "45'", type: { name: "STATUS_IN_PROGRESS", state: "in" } },
        competitors: [
          { homeAway: "home", score: "1", team: { id: "111", displayName: "Real Madrid", logo: "https://x/rm.png" } },
          { homeAway: "away", score: "0", team: { id: "222", displayName: "Manchester City", logo: "https://x/mc.png" } },
        ],
      },
    ],
    ...overrides,
  };
}

test("expose les 7 championnats du prompt 1 (LDC/Europa/Conference + Russie/Suède/Slovaquie/Lettonie)", () => {
  expect(LEAGUE_SLUGS.UEFA_CHAMPIONS_LEAGUE.slug).toBe("uefa.champions");
  expect(LEAGUE_SLUGS.UEFA_EUROPA_LEAGUE.slug).toBe("uefa.europa");
  expect(LEAGUE_SLUGS.UEFA_CONFERENCE_LEAGUE.slug).toBe("uefa.europa.conf");
  expect(LEAGUE_SLUGS.RUSSIA_PREMIER_LEAGUE.slug).toBe("rus.1");
  expect(LEAGUE_SLUGS.SWEDEN_ALLSVENSKAN.slug).toBe("swe.1");
  expect(LEAGUE_SLUGS.SLOVAKIA_SUPER_LIGA.slug).toBe("svk.1");
  expect(LEAGUE_SLUGS.LATVIA_VIRSLIGA.slug).toBe("lat.1");
});

describe("mapEspnEventToMatch", () => {
  test("match en direct : même forme que components/MatchCard.js attend (id, competition, homeTeam, awayTeam, status, score)", () => {
    const m = mapEspnEventToMatch(espnEvent(), "uefa.champions", "Ligue des Champions");
    expect(m.id).toBe("espn-uefa.champions-401598010");
    expect(m.competition.name).toBe("Ligue des Champions");
    expect(m.homeTeam).toEqual({ id: "espn-team-111", name: "Real Madrid", crest: "https://x/rm.png" });
    expect(m.awayTeam).toEqual({ id: "espn-team-222", name: "Manchester City", crest: "https://x/mc.png" });
    expect(m.status).toBe("IN_PLAY");
    expect(m.minute).toBe("45");
    expect(m.score.fullTime).toEqual({ home: 1, away: 0 });
    expect(m.utcDate).toBe("2026-08-10T18:00:00Z");
  });

  test("match pas encore commencé : jamais de score affiché, même si l'API renvoie \"0\"-\"0\"", () => {
    const event = espnEvent({
      competitions: [
        {
          date: "2026-08-10T18:00:00Z",
          status: { displayClock: "0'", type: { name: "STATUS_SCHEDULED", state: "pre" } },
          competitors: [
            { homeAway: "home", score: "0", team: { id: "111", displayName: "Real Madrid" } },
            { homeAway: "away", score: "0", team: { id: "222", displayName: "Manchester City" } },
          ],
        },
      ],
    });
    const m = mapEspnEventToMatch(event, "uefa.champions", "Ligue des Champions");
    expect(m.status).toBe("SCHEDULED");
    expect(m.score.fullTime).toEqual({ home: null, away: null });
  });

  test("mi-temps, prolongation, tirs au but : statuts spécifiques reconnus par mot-clé", () => {
    const half = mapEspnEventToMatch(
      espnEvent({ competitions: [{ status: { type: { name: "STATUS_HALFTIME", state: "in" } }, competitors: espnEvent().competitions[0].competitors }] }),
      "eng.1", "Premier League"
    );
    expect(half.status).toBe("PAUSED");

    const extra = mapEspnEventToMatch(
      espnEvent({ competitions: [{ status: { type: { name: "STATUS_END_EXTRA_TIME", state: "in" } }, competitors: espnEvent().competitions[0].competitors }] }),
      "uefa.champions", "Ligue des Champions"
    );
    expect(extra.status).toBe("EXTRA_TIME");

    const pens = mapEspnEventToMatch(
      espnEvent({ competitions: [{ status: { type: { name: "STATUS_PENALTIES", state: "in" } }, competitors: espnEvent().competitions[0].competitors }] }),
      "uefa.champions", "Ligue des Champions"
    );
    expect(pens.status).toBe("PENALTY_SHOOTOUT");
  });

  test("match terminé : statut FINISHED, score conservé", () => {
    const event = espnEvent({
      competitions: [
        {
          date: "2026-08-10T18:00:00Z",
          status: { type: { name: "STATUS_FULL_TIME", state: "post", completed: true } },
          competitors: [
            { homeAway: "home", score: "2", team: { id: "111", displayName: "Real Madrid" } },
            { homeAway: "away", score: "1", team: { id: "222", displayName: "Manchester City" } },
          ],
        },
      ],
    });
    const m = mapEspnEventToMatch(event, "uefa.champions", "Ligue des Champions");
    expect(m.status).toBe("FINISHED");
    expect(m.score.fullTime).toEqual({ home: 2, away: 1 });
  });

  test("champs inattendus/absents : jamais un plantage, jamais une donnée inventée (noms/logos honnêtement vides ou génériques)", () => {
    expect(() => mapEspnEventToMatch({}, "uefa.champions", "Ligue des Champions")).not.toThrow();
    const m = mapEspnEventToMatch({}, "uefa.champions", "Ligue des Champions");
    expect(m.homeTeam.name).toBe("Équipe à domicile");
    expect(m.awayTeam.name).toBe("Équipe à l'extérieur");
    expect(m.score.fullTime).toEqual({ home: null, away: null });
    expect(m.status).toBe("SCHEDULED");
  });
});

describe("fetchLeagueScoreboard / getLeagueMatches", () => {
  afterEach(() => {
    delete global.fetch;
  });

  test("appelle bien l'endpoint scoreboard ESPN du bon championnat, sans clé API", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ events: [espnEvent()] }) }));
    const events = await fetchLeagueScoreboard("uefa.champions");
    expect(events).toHaveLength(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard");
    expect(url).not.toMatch(/apikey|api_key|token/i);
  });

  test("HTTP en erreur (429, 500...) : lève une erreur explicite, jamais une liste vide silencieuse en amont", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429 }));
    await expect(fetchLeagueScoreboard("rus.1")).rejects.toThrow(/429/);
  });

  test("réseau indisponible : l'erreur remonte (à l'appelant de décider, voir ExternalMatchesWidget)", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("network unreachable")));
    await expect(fetchLeagueScoreboard("lat.1")).rejects.toThrow("network unreachable");
  });

  test("réponse sans champ events : liste vide honnête, jamais un plantage", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const events = await fetchLeagueScoreboard("svk.1");
    expect(events).toEqual([]);
  });

  test("getLeagueMatches ignore les événements sans deux équipes (jamais une carte à moitié vide)", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ events: [espnEvent(), { id: "x", competitions: [{ competitors: [] }] }] }) })
    );
    const matches = await getLeagueMatches("uefa.champions", "Ligue des Champions");
    expect(matches).toHaveLength(1);
  });
});
