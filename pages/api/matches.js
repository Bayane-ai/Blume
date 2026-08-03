import { COMPETITIONS } from "../../lib/competitions";
import { getStandingsTable } from "../../lib/standingsCache";
import { computePronostic } from "../../lib/pronostic";
import { getFixturesByDate, getActiveLeagues, mapFixtureToUpcomingMatch, normalizeTeamName } from "../../lib/apiFootball";
import { maybeSweepFinishedPredictions } from "../../lib/pronosticHistory";
import { recordLastError } from "../../lib/apiQuota";

const BASE = "https://api.football-data.org/v4";
const SOURCE_KEY = "football-data";
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

  // RÈGLEMENT AUTOMATIQUE DE FIN DE MATCH (voir lib/pronosticHistory.js) : cette page
  // est visitée bien plus souvent que "Probabilités réussies/échouées" — en profiter
  // (throttlé à un balayage réel toutes les 5 min, jamais attendu) fait que le
  // classement Succès/Échec d'un match ne dépend plus d'une visite délibérée de ces
  // deux pages précises.
  maybeSweepFinishedPredictions(token, apiFootballKey);

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
      // Jamais avalée silencieusement : cette source alimente TOUS les matchs des 12
      // grandes ligues (voir lib/competitions.js) — sa panne vide la quasi-totalité de
      // la page. Le corps de la réponse précise la vraie cause (jeton invalide, quota
      // dépassé, service indisponible...), consultable sur /admin sans les logs Vercel.
      const body = typeof r.text === "function" ? await r.text().catch(() => "") : "";
      const message = `football-data.org a répondu ${r.status} sur /matches : ${body.slice(0, 300)}`;
      console.error(`[football-data] ${message}`);
      recordLastError(SOURCE_KEY, message);
      return res.status(r.status).json({ error: `Erreur API football-data (code ${r.status})` });
    }
    const data = await r.json();
    // Aucune restriction par ligue, pays, fédération ou catégorie d'âge : toute
    // compétition renvoyée par l'API (y compris jeunes, réserves, petits championnats
    // nationaux) est affichée telle quelle.
    const fdMatches = data.matches || [];

    // football-data.org (plan gratuit) ne couvre qu'un nombre restreint de
    // compétitions (voir lib/competitions.js) — API-Football comble ce trou pour les
    // matchs À VENIR (jamais commencés, statut "NS") de la même façon que
    // pages/api/live-matches.js le fait déjà pour le direct : toutes fédérations, tous
    // pays, sans restriction. Une panne d'API-Football ne doit jamais vider la liste :
    // on garde alors simplement les matchs football-data.org.
    let afMatches = [];
    if (!apiFootballKey) {
      // Sans cette clé, TOUTE compétition absente de lib/competitions.js (la quasi-
      // totalité du monde du football hors 12 grandes ligues) reste invisible sur le
      // site — un écran vide silencieux en apparence, alors que la vraie cause est une
      // variable d'environnement manquante côté Vercel. Le log permet de trancher tout
      // de suite entre "clé absente" et "API-Football n'a rien à ajouter maintenant".
      console.warn("[API-Football] API_FOOTBALL_KEY absente : aucune compétition hors football-data.org ne sera affichée (matchs à venir)");
    } else {
      try {
        // Fenêtre élargie d'un jour vers le passé (hier UTC en plus d'aujourd'hui..+7) :
        // getFixturesByDate interroge désormais explicitement en UTC (timezone=UTC), mais
        // un match dont l'heure LOCALE tombe "aujourd'hui" pour un visiteur très en avance
        // sur UTC (ex : Japon, UTC+9, un match tôt le matin) peut avoir un `date` UTC
        // encore "hier" — sans ce jour supplémentaire, ce match ne serait interrogé par
        // aucune des dates de la boucle et disparaîtrait entièrement.
        const dateStrings = Array.from({ length: NUM_DAYS + 1 }, (_, i) => isoDate(new Date(Date.now() + (i - 1) * 24 * 3600000)));
        const perDate = await Promise.all(dateStrings.map((d) => getFixturesByDate(d, apiFootballKey)));
        // Visibilité serveur (logs Vercel) : sans ça, une source qui répond mais ne
        // renvoie rien (quota épuisé, aucun match programmé dans la fenêtre) est
        // indiscernable d'une source qui échoue silencieusement — utile pour
        // diagnostiquer l'absence d'un championnat précis (ex : petite fédération)
        // sans devoir deviner.
        console.log(`[API-Football] /fixtures?date=... (${dateStrings.length} jours) : ${perDate.flat().length} match(s) reçu(s) au total`);
        const known = new Set(
          fdMatches.map((m) => `${normalizeTeamName(m.homeTeam?.name)}|${normalizeTeamName(m.awayTeam?.name)}`)
        );
        // Seuls les matchs pas encore commencés : le direct est déjà couvert ailleurs,
        // inutile (et risqué) de mélanger un statut différent ici. "NS" (horaire
        // confirmé) ET "TBD" (horaire pas encore officiellement fixé par la fédération —
        // fréquent pour les compétitions moins suivies, coupes et supercoupes) comptent
        // toutes les deux comme "pas commencé" : ne garder que "NS" ferait disparaître
        // silencieusement tout match dont l'heure n'est pas encore confirmée. Le filtre
        // sur `utcDate` juste après protège quand même contre une vraie date absente.
        const NOT_STARTED_STATUSES = new Set(["NS", "TBD"]);
        afMatches = perDate
          .flat()
          .filter((f) => NOT_STARTED_STATUSES.has(f?.fixture?.status?.short))
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

    // Visibilité diagnostique (jamais un filtre, voir lib/apiFootball.js#getActiveLeagues) :
    // en arrière-plan, jamais attendue (ne doit jamais ralentir cette réponse — quasi
    // toujours servie depuis le cache 24h), compare le nombre de compétitions RÉELLEMENT
    // actives cette saison (toutes fédérations) au nombre de compétitions effectivement
    // représentées ci-dessus, pour repérer dans les logs Vercel un écart durable plutôt
    // que de devoir le deviner.
    if (apiFootballKey) {
      getActiveLeagues(apiFootballKey)
        .then((leagues) => {
          const areasShown = new Set([...byCode.values()].map((c) => (c.area || "").toLowerCase()));
          const missingCountries = [...new Set(leagues.map((l) => l.country?.name).filter(Boolean))].filter(
            (country) => !areasShown.has(country.toLowerCase())
          );
          console.log(
            `[API-Football] /leagues?current=true : ${leagues.length} compétition(s) active(s) cette saison, ${areasShown.size} pays/fédération(s) représenté(s) dans les matchs affichés` +
              (missingCountries.length ? ` — aucun match affiché aujourd'hui pour : ${missingCountries.slice(0, 15).join(", ")}${missingCountries.length > 15 ? "…" : ""}` : "")
          );
        })
        .catch(() => {});
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
    console.error("[/api/matches] Erreur inattendue :", e.message);
    recordLastError(SOURCE_KEY, `Erreur inattendue /api/matches : ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
}
