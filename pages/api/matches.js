import { COMPETITIONS } from "../../lib/competitions";
import { getStandingsTable } from "../../lib/standingsCache";
import { computePronostic } from "../../lib/pronostic";
import { getFixturesByDate, mapFixtureToUpcomingMatch, normalizeTeamName } from "../../lib/apiFootball";

const BASE = "https://api.football-data.org/v4";
const NUM_DAYS = 8; // aujourd'hui + 7 jours, même fenêtre que dateFrom/dateTo ci-dessous

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function attachPronostic(m, table) {
  const homeRow = table?.find((row) => String(row.team.id) === String(m.homeTeam?.id));
  const awayRow = table?.find((row) => String(row.team.id) === String(m.awayTeam?.id));
  // computePronostic se rabat sur une estimation moyenne si une équipe est absente du
  // classement (phase à élimination directe, etc.) : le pronostic est toujours disponible.
  const pronostic = computePronostic({
    homeRow, awayRow, homeTeamName: m.homeTeam?.name, awayTeamName: m.awayTeam?.name,
  });
  return { ...m, pronostic };
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  const dateFrom = isoDate(new Date());
  const dateTo = isoDate(new Date(Date.now() + 7 * 24 * 3600000));

  try {
    // Un seul appel global (toutes compétitions confondues, sans filtre d'aucune sorte)
    // au lieu d'un appel par compétition : le plan gratuit football-data.org limite à
    // 10 requêtes/minute, et 12 appels en parallèle (+ le rafraîchissement automatique)
    // dépassait ce quota, ce qui faisait disparaître silencieusement tous les matchs.
    const r = await fetch(
      `${BASE}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED,TIMED,LIVE,IN_PLAY,PAUSED,FINISHED&limit=100`,
      { headers: { "X-Auth-Token": token } }
    );
    if (!r.ok) {
      return res.status(r.status).json({ error: `Erreur API football-data (code ${r.status})` });
    }
    const data = await r.json();
    const fdMatches = data.matches || [];

    // football-data.org (plan gratuit) ne couvre qu'un nombre restreint de
    // compétitions (voir lib/competitions.js) — API-Football comble ce trou pour les
    // matchs À VENIR (jamais commencés, statut "NS") de la même façon que
    // pages/api/live-matches.js le fait déjà pour le direct : toutes fédérations, tous
    // pays, y compris les catégories jeunes (U17/U19/U20...) quand API-Football les
    // couvre. Une panne d'API-Football ne doit jamais vider la liste : on garde alors
    // simplement les matchs football-data.org.
    let afMatches = [];
    if (apiFootballKey) {
      try {
        const dateStrings = Array.from({ length: NUM_DAYS }, (_, i) => isoDate(new Date(Date.now() + i * 24 * 3600000)));
        const perDate = await Promise.all(dateStrings.map((d) => getFixturesByDate(d, apiFootballKey)));
        const known = new Set(
          fdMatches.map((m) => `${normalizeTeamName(m.homeTeam?.name)}|${normalizeTeamName(m.awayTeam?.name)}`)
        );
        afMatches = perDate
          .flat()
          // Seuls les matchs pas encore commencés : le direct est déjà couvert
          // ailleurs, inutile (et risqué) de mélanger un statut différent ici.
          .filter((f) => f?.fixture?.status?.short === "NS")
          .filter((f) => !known.has(`${normalizeTeamName(f?.teams?.home?.name)}|${normalizeTeamName(f?.teams?.away?.name)}`))
          .map(mapFixtureToUpcomingMatch)
          .filter((m) => m.homeTeam.name && m.awayTeam.name && m.utcDate);
      } catch (e) {
        console.error("Erreur matchs à venir API-Football:", e.message);
      }
    }

    // Regroupe par compétition RÉELLEMENT présente dans les matchs reçus — jamais une
    // liste de compétitions fixée à l'avance : une compétition absente de
    // lib/competitions.js (n'importe quelle fédération, n'importe quel pays, toute
    // coupe ou catégorie jeune que l'API renvoie réellement) doit quand même apparaître,
    // au lieu d'être silencieusement écartée.
    const byCode = new Map(); // code -> { name, area, matches: [] }
    for (const m of [...fdMatches, ...afMatches]) {
      const code = m.competition?.code;
      if (!code) continue;
      if (!byCode.has(code)) {
        byCode.set(code, { name: m.competition?.name || code, area: m.competition?.area || "", matches: [] });
      }
      byCode.get(code).matches.push(m);
    }

    // Le classement (pour le pronostic précalculé) n'existe que côté football-data.org
    // — les compétitions connues uniquement par API-Football (codes préfixés "af-")
    // n'ont pas de classement disponible ici ; leur pronostic se rabat alors sur la même
    // réponse "indisponible" que pour les matchs en direct API-Football (voir
    // pages/api/live-matches.js), jamais une erreur qui casserait la page.
    const fdCodesWithMatches = [...byCode.keys()].filter((code) => !code.startsWith("af-"));
    const standingsByCode = {};
    await Promise.all(
      fdCodesWithMatches.map(async (code) => {
        standingsByCode[code] = await getStandingsTable(code, token);
      })
    );

    // Priorité d'affichage : les compétitions majeures connues (lib/competitions.js)
    // d'abord, dans leur ordre habituel, puis TOUTES les autres compétitions
    // réellement trouvées, triées alphabétiquement — jamais une compétition ignorée
    // simplement parce qu'elle ne figure pas dans cette liste de priorité.
    const priorityCodes = COMPETITIONS.map((c) => c.code);
    const allCodes = [...byCode.keys()];
    const orderedCodes = [
      ...priorityCodes.filter((code) => byCode.has(code)),
      ...allCodes
        .filter((code) => !priorityCodes.includes(code))
        .sort((a, b) => byCode.get(a).name.localeCompare(byCode.get(b).name)),
    ];

    const results = orderedCodes.map((code) => {
      const known = COMPETITIONS.find((c) => c.code === code);
      const entry = byCode.get(code);
      const matches = entry.matches.map((m) =>
        code.startsWith("af-") ? { ...m, pronostic: { available: false } } : attachPronostic(m, standingsByCode[code])
      );
      return { code, name: known?.name || entry.name, area: known?.area || entry.area, matches };
    });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ competitions: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
