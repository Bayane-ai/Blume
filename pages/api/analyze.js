import { getStandingsTable } from "../../lib/standingsCache";
import { getTeamRecentForm } from "../../lib/teamForm";
import { getLiveMatch } from "../../lib/liveMatchCache";
import { getHeadToHead } from "../../lib/headToHead";
import { getScorers } from "../../lib/scorersCache";
import { buildProbableScorers } from "../../lib/probableScorers";
import { saveAndVerifyPrediction } from "../../lib/pronosticHistory";
import { computePronostic, computeLivePronostic } from "../../lib/pronostic";
import {
  getAllLiveFixtures, findLiveFixtureByTeams, getFixtureEvents, mapApiFootballEvents, mapFixtureToLiveState,
  findApiFootballTeamId, getTeamCardProneness, getFixtureStatistics, mapFixtureStatistics,
} from "../../lib/apiFootball";

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

// "Joueurs susceptibles de prendre un carton" (bloc "Corners et cartons") : football-
// data.org n'a aucune statistique de cartons par joueur — voir lib/apiFootball.js pour
// la source réelle (API-Football, best-effort). Sans clé API-Football, ou si l'équipe
// n'est pas retrouvée, renvoie honnêtement une liste vide plutôt qu'un plantage ou une
// donnée inventée.
async function resolveCardProneness(teamName, key) {
  if (!key || !teamName) return [];
  const teamId = await findApiFootballTeamId(teamName, key);
  if (!teamId) return [];
  return getTeamCardProneness(teamId, key);
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const { matchId, competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = req.query;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });
  if (!competitionCode || !homeTeamId || !awayTeamId) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }

  try {
    const apiFootballKey = process.env.API_FOOTBALL_KEY;
    // Un match connu UNIQUEMENT par API-Football (hors des compétitions couvertes par
    // le plan gratuit football-data.org — voir pages/api/live-matches.js) porte un id
    // préfixé "af-" : jamais interrogé auprès de football-data.org, dont les ids sont
    // numérotés indépendamment et pourraient par coïncidence désigner un tout autre match.
    const isApiFootballOnlyId = typeof matchId === "string" && matchId.startsWith("af-");

    // Le score/la minute viennent toujours de l'API, jamais d'une valeur transmise par
    // le client. Le cache de quelques secondes ici n'est pas "figé" : il sert seulement
    // à mutualiser les appels entre plusieurs visiteurs qui suivent le même match en
    // même temps, pour pouvoir actualiser souvent sans dépasser le quota de l'API
    // (sinon les requêtes échouent et le pronostic retombe silencieusement sur
    // l'estimation pré-match au lieu de suivre le score réel).
    let liveMatch = matchId && !isApiFootballOnlyId ? await getLiveMatch(matchId, token) : null;

    // football-data.org ne connaît pas ce match (hors de ses compétitions couvertes, ou
    // id "af-") : on retombe sur API-Football pour le score/minute en direct — jamais un
    // match affiché comme "en direct" sans une vraie source qui le confirme réellement.
    let apiFootballFixture = null;
    if (!liveMatch && apiFootballKey && homeTeamName && awayTeamName) {
      const liveFixtures = await getAllLiveFixtures(apiFootballKey);
      apiFootballFixture = findLiveFixtureByTeams(liveFixtures, homeTeamName, awayTeamName);
      if (apiFootballFixture) liveMatch = mapFixtureToLiveState(apiFootballFixture);
    }

    const table = isApiFootballOnlyId ? null : await getStandingsTable(competitionCode, token);

    // Le classement (`table`) sert de repli et de contexte d'affichage (position,
    // points) — resolveTeamStats calcule d'abord chaque équipe à partir de SES
    // propres derniers matchs joués (voir lib/teamForm.js), jamais mélangés entre
    // les deux équipes. Une équipe absente du classement (phase à élimination
    // directe, coupe sans tableau, etc.) reste donc analysable normalement.
    // Les vraies confrontations directes entre CES deux équipes (lib/headToHead.js)
    // affinent ensuite le résultat quand l'API en fournit assez (voir lib/pronostic.js).
    const homeStandingsRow = table?.find((r) => String(r.team.id) === String(homeTeamId));
    const awayStandingsRow = table?.find((r) => String(r.team.id) === String(awayTeamId));
    const [homeResolved, awayResolved, h2h, scorers, homeCardProneness, awayCardProneness] = await Promise.all([
      resolveTeamStats(homeTeamId, homeStandingsRow, token),
      resolveTeamStats(awayTeamId, awayStandingsRow, token),
      matchId && !isApiFootballOnlyId ? getHeadToHead(matchId, token) : Promise.resolve(null),
      // "Buteurs probables" (voir lib/probableScorers.js) : indisponible pour un match
      // connu uniquement d'API-Football (hors compétitions football-data.org).
      isApiFootballOnlyId ? Promise.resolve(null) : getScorers(competitionCode, token),
      resolveCardProneness(homeTeamName, apiFootballKey),
      resolveCardProneness(awayTeamName, apiFootballKey),
    ]);

    const isLive = liveMatch && LIVE_STATUSES.includes(liveMatch.status);

    // Corners/hors-jeu/fautes en direct (blocs dédiés, voir lib/pronostic.js —
    // buildMatchStats) : résolu AVANT le calcul du pronostic pour pouvoir lui passer le
    // vrai décompte observé depuis le début du match, quand la donnée existe. Réutilisé
    // plus bas pour les événements (buts/cartons/remplacements), qui ont besoin du même
    // fixture API-Football — jamais une deuxième recherche identique.
    let liveRealStats = null;
    if (isLive && apiFootballKey) {
      try {
        if (!apiFootballFixture) {
          const liveFixtures = await getAllLiveFixtures(apiFootballKey);
          apiFootballFixture = findLiveFixtureByTeams(liveFixtures, homeTeamName, awayTeamName);
        }
        if (apiFootballFixture?.fixture?.id) {
          const rawStats = await getFixtureStatistics(apiFootballFixture.fixture.id, apiFootballKey);
          if (rawStats) liveRealStats = mapFixtureStatistics(rawStats, apiFootballFixture.teams?.home?.id);
        }
      } catch (e) {
        console.error("Erreur statistiques live (API-Football):", e.message);
        // liveRealStats reste null : repli honnête sur l'estimation pré-match (voir
        // buildMatchStats), jamais un plantage de toute la page pour cette seule donnée.
      }
    }

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
          status: liveMatch.status,
          liveRealStats,
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

    // "Buteurs probables" : filtré sur les vrais joueurs de CHAQUE équipe (jamais
    // mélangés), à partir du classement des buteurs/passeurs réels de la compétition —
    // voir lib/probableScorers.js pour la logique et son honnêteté sur ce que la donnée
    // représente réellement (total saison, pas match par match).
    result.probableScorers = buildProbableScorers(scorers, homeTeamId, awayTeamId);
    // Best-effort (API-Football) : voir lib/apiFootball.js — jamais un joueur inventé,
    // liste vide et honnête ("Indisponible" côté interface) si la source ne répond pas.
    result.cardProneness = { home: homeCardProneness, away: awayCardProneness };

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
    if (isLive && apiFootballKey) {
      try {
        // Réutilise le match déjà trouvé ci-dessus (repli score/minute) s'il existe,
        // pour ne pas refaire une deuxième recherche identique côté API-Football.
        if (!apiFootballFixture) {
          const liveFixtures = await getAllLiveFixtures(apiFootballKey);
          apiFootballFixture = findLiveFixtureByTeams(liveFixtures, homeTeamName, awayTeamName);
        }
        if (apiFootballFixture?.fixture?.id) {
          const rawEvents = await getFixtureEvents(apiFootballFixture.fixture.id, apiFootballKey);
          if (rawEvents !== null) {
            result.events = mapApiFootballEvents(rawEvents, {
              fixtureHomeId: apiFootballFixture.teams?.home?.id,
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

    // Historique "Probabilités réussies/échouées" (voir lib/pronosticHistory.js) :
    // sauvegarde le pronostic la première fois que ce match est analysé, et le classe
    // Succès/Échec dès qu'on constate qu'il est terminé — automatique, sans action de
    // l'utilisateur au-delà du simple fait d'avoir consulté cette page au moins une
    // fois. Jamais fatal pour le reste de la réponse (le pronostic doit toujours être
    // renvoyé), même si cette fonction échouait d'une façon imprévue par son propre
    // gestionnaire d'erreurs interne — sécurité redondante, comme pour les événements
    // live ci-dessus.
    if (liveMatch) {
      try {
        await saveAndVerifyPrediction({
          matchId,
          competitionCode,
          homeTeamName,
          awayTeamName,
          matchDate: liveMatch.utcDate || null,
          prediction: result,
          matchStatus: liveMatch.status,
          finalScore: liveMatch.score?.fullTime || null,
        });
      } catch (e) {
        console.error("Erreur historique pronostic:", e.message);
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
