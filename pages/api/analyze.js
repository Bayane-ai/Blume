import { getStandingsTable } from "../../lib/standingsCache";
import { getTeamRecentForm } from "../../lib/teamForm";
import { getLiveMatch } from "../../lib/liveMatchCache";
import { getHeadToHead } from "../../lib/headToHead";
import { computePronostic, computeLivePronostic } from "../../lib/pronostic";
import { getAllLiveFixtures, findLiveFixtureByTeams, getFixtureEvents, mapApiFootballEvents } from "../../lib/apiFootball";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

// Base de calcul du pronostic : la performance RÉCENTE et RÉELLE de chaque club
// (ses derniers matchs joués — forme, buts marqués/encaissés, résultats), pas une
// moyenne de saison qui gomme les différences entre deux équipes proches au
// classement. C'est ce qui rend chaque match réellement distinct : deux équipes de
// milieu de tableau avec des moyennes de saison presque identiques peuvent très
// bien traverser une période très différente (l'une en pleine forme, l'autre en
// crise) — seuls les derniers matchs le montrent. Le classement (position/points),
// quand disponible, ne sert plus qu'à enrichir l'affichage (contexte), et ne
// redevient la base du calcul que si les derniers matchs sont indisponibles.
async function resolveTeamStats(teamId, standingsRow, token) {
  const recentForm = await getTeamRecentForm(teamId, token);
  if (recentForm) {
    return {
      stats: {
        ...recentForm,
        position: standingsRow?.position ?? null,
        points: standingsRow?.points ?? null,
        form: recentForm.form || standingsRow?.form || null,
      },
      source: "forme récente",
    };
  }

  if (standingsRow && standingsRow.playedGames) {
    return { stats: standingsRow, source: "classement" };
  }

  return { stats: null, source: "estimation moyenne" };
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const { matchId, competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = req.query;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });
  if (!competitionCode || !homeTeamId || !awayTeamId) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }

  try {
    // Le score/la minute viennent toujours de l'API, jamais d'une valeur transmise par
    // le client. Le cache de quelques secondes ici n'est pas "figé" : il sert seulement
    // à mutualiser les appels entre plusieurs visiteurs qui suivent le même match en
    // même temps, pour pouvoir actualiser souvent sans dépasser le quota de l'API
    // (sinon les requêtes échouent et le pronostic retombe silencieusement sur
    // l'estimation pré-match au lieu de suivre le score réel).
    const liveMatch = matchId ? await getLiveMatch(matchId, token) : null;

    const table = await getStandingsTable(competitionCode, token);

    // Le classement (`table`) sert de repli et de contexte d'affichage (position,
    // points) — resolveTeamStats calcule d'abord chaque équipe à partir de SES
    // propres derniers matchs joués (voir lib/teamForm.js), jamais mélangés entre
    // les deux équipes. Une équipe absente du classement (phase à élimination
    // directe, coupe sans tableau, etc.) reste donc analysable normalement.
    // Les vraies confrontations directes entre CES deux équipes (lib/headToHead.js)
    // affinent ensuite le résultat quand l'API en fournit assez (voir lib/pronostic.js).
    const homeStandingsRow = table?.find((r) => String(r.team.id) === String(homeTeamId));
    const awayStandingsRow = table?.find((r) => String(r.team.id) === String(awayTeamId));
    const [homeResolved, awayResolved, h2h] = await Promise.all([
      resolveTeamStats(homeTeamId, homeStandingsRow, token),
      resolveTeamStats(awayTeamId, awayStandingsRow, token),
      matchId ? getHeadToHead(matchId, token) : Promise.resolve(null),
    ]);

    const isLive = liveMatch && LIVE_STATUSES.includes(liveMatch.status);
    const result = isLive
      ? computeLivePronostic({
          homeRow: homeResolved.stats,
          awayRow: awayResolved.stats,
          homeTeamName,
          awayTeamName,
          homeSource: homeResolved.source,
          awaySource: awayResolved.source,
          currentHome: liveMatch.score?.fullTime?.home,
          currentAway: liveMatch.score?.fullTime?.away,
          minute: liveMatch.minute,
          h2h,
        })
      : computePronostic({
          homeRow: homeResolved.stats,
          awayRow: awayResolved.stats,
          homeTeamName,
          awayTeamName,
          homeSource: homeResolved.source,
          awaySource: awayResolved.source,
          h2h,
        });

    if (liveMatch) {
      result.matchStatus = liveMatch.status;
      result.matchMinute = liveMatch.minute;
      result.matchScore = liveMatch.score?.fullTime || null;
      // Non fournis par l'API pour tous les matchs/compétitions : null quand absent,
      // affiché comme "Indisponible" côté client plutôt que masqué silencieusement.
      result.venue = liveMatch.venue || null;
      result.referee = liveMatch.referees?.[0]?.name || null;
    }

    // La ressource "match" de football-data.org (plan utilisé ici) ne fournit pas de
    // fil d'événements minute par minute (buts/cartons/remplacements) — seulement le
    // score et l'état du match. Pour un match en direct, on va chercher ce fil réel chez
    // API-Football (voir lib/apiFootball.js) ; `events` ne reste `null` que si aucune
    // source ne peut fournir la donnée (pas de clé API, match introuvable côté
    // API-Football, ou erreur de la source) — jamais de donnée inventée pour remplir la
    // timeline (components/MatchTimeline.js), qui distingue "indisponible" (null)
    // d'"aucun événement pour l'instant" (tableau vide, mais source bien connectée).
    result.events = null;
    const apiFootballKey = process.env.API_FOOTBALL_KEY;
    if (isLive && apiFootballKey) {
      try {
        const liveFixtures = await getAllLiveFixtures(apiFootballKey);
        const fixture = findLiveFixtureByTeams(liveFixtures, homeTeamName, awayTeamName);
        if (fixture?.fixture?.id) {
          const rawEvents = await getFixtureEvents(fixture.fixture.id, apiFootballKey);
          if (rawEvents !== null) {
            result.events = mapApiFootballEvents(rawEvents, {
              fixtureHomeId: fixture.teams?.home?.id,
              homeTeamId,
              awayTeamId,
            });
          }
        }
      } catch (e) {
        console.error("Erreur événements live (API-Football):", e.message);
        // events reste null : jamais de donnée inventée si la source échoue.
      }
    }

    // Même raison que dans live-matches.js : sous charge, Vercel peut répartir les
    // requêtes sur plusieurs instances qui ne partagent pas leur cache mémoire
    // (liveMatchCache.js). Cet en-tête fait que le réseau Vercel mutualise réellement
    // les réponses (par match, via l'URL complète en clé de cache) entre toutes les
    // instances, ce qui borne le nombre d'appels à l'API football-data.org même si
    // plusieurs visiteurs suivent le même match en même temps sur des instances
    // différentes.
    res.setHeader("Cache-Control", "s-maxage=3, stale-while-revalidate=20");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
