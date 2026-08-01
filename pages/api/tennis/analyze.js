// Bloc 7 (pronostics tennis) — équivalent tennis de pages/api/analyze.js (football)
// et pages/api/basketball/analyze.js : croise les profils réels des deux joueurs
// (lib/sports/tennis/statProfiles.js) pour produire toutes les lignes de pronostic
// (lib/sports/tennis/pronosticModel.js), puis recalcule EN DIRECT uniquement la
// probabilité de victoire, les scores en sets probables et les totaux de jeux — le
// reste (aces/doubles fautes/breaks/tie-break/handicap) reste figé (voir PROMPT,
// "Règle figé/live").
//
// Contrairement au football/basket, PAS de figeage/vérification Supabase ici (pas de
// table pronostic_history pour le tennis à ce stade) : chaque consultation recalcule
// à partir des profils de joueur, eux-mêmes mis en cache en mémoire (24h, voir
// statProfiles.js) — un choix de portée assumé pour ce premier bloc pronostics
// tennis, cohérent avec l'architecture 100% en mémoire déjà en place depuis le bloc 5
// (lib/sports/tennis/provider.js). Le "Probabilités réussies/échouées" pour le tennis
// pourra être branché dans un bloc ultérieur, comme cela a été fait pour le basket
// après ses propres pronostics.
import { getTennisApiKey, getGameById, getHeadToHead } from "../../../lib/sports/tennis/provider";
import { mapMatchToLiveState } from "../../../lib/sports/tennis/mapper";
import { getOrBuildPlayerProfile } from "../../../lib/sports/tennis/statProfiles";
import { computeTennisPronostic, computeTennisLiveOverlay } from "../../../lib/sports/tennis/pronosticModel";

// Les ids transmis par components/MatchCard.js#matchHref portent le préfixe "tn-"
// (voir lib/sports/tennis/mapper.js) — jamais envoyés tels quels à l'API, qui attend
// ses propres ids numériques.
function stripPrefix(id) {
  if (typeof id !== "string") return null;
  const n = id.startsWith("tn-") ? id.slice(3) : id;
  return n || null;
}

// Grand Chelem masculin = 5 sets gagnants ; tout le reste (ATP hors Grand Chelem,
// WTA y compris ses propres Grands Chelems) = 3 — voir PROMPT. La forme exacte du
// champ "catégorie" renvoyé par API-Tennis n'a pas pu être vérifiée en direct depuis
// cet environnement (réseau bloqué, voir lib/sports/tennis/provider.js) : détection
// par mot-clé, robuste à une variante de casse, plutôt qu'une correspondance exacte
// fragile — même principe que mapMatchStatusToBlumeStatus.
function determineBestOf(category) {
  const text = (category || "").toLowerCase();
  const isGrandSlam = /grand\s*slam|grand\s*chelem/.test(text);
  const isWTA = /wta/.test(text);
  return isGrandSlam && !isWTA ? 5 : 3;
}

// Un set est réellement TERMINÉ à 6 (ou plus) jeux avec 2 jeux d'écart, ou à 7-6/7-5
// (jeu décisif ou break au 12e jeu) — jamais déduit du simple fait qu'un joueur mène
// actuellement dans le set en cours (voir lib/sports/tennis/mapper.js#computeSetsWon,
// dont le repli par set peut à tort compter un set encore en cours comme déjà gagné
// par celui qui mène : cette fonction-ci, plus stricte, sert spécifiquement à séparer
// les sets vraiment finis du set en cours pour le recalcul en direct ci-dessous).
function isSetComplete(s) {
  if (s?.home == null || s?.away == null) return false;
  const diff = Math.abs(s.home - s.away);
  if (Math.max(s.home, s.away) >= 6 && diff >= 2) return true;
  if (s.home === 7 || s.away === 7) return true;
  return false;
}

function deriveLiveSetsState(sets) {
  let setsWonHome = 0;
  let setsWonAway = 0;
  let gamesPlayedHome = 0;
  let gamesPlayedAway = 0;
  let currentSetGamesHome = 0;
  let currentSetGamesAway = 0;
  for (const s of sets || []) {
    if (s?.home == null && s?.away == null) continue;
    const h = s.home ?? 0;
    const a = s.away ?? 0;
    gamesPlayedHome += h;
    gamesPlayedAway += a;
    if (isSetComplete(s)) {
      if (h > a) setsWonHome += 1;
      else if (a > h) setsWonAway += 1;
    } else {
      currentSetGamesHome = h;
      currentSetGamesAway = a;
    }
  }
  return { setsWonHome, setsWonAway, currentSetGamesHome, currentSetGamesAway, gamesPlayedHome, gamesPlayedAway };
}

export default async function handler(req, res) {
  const apiKey = getTennisApiKey();
  if (!apiKey) return res.status(500).json({ available: false, error: "Clé API tennis manquante" });

  const { matchId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, surface, category } = req.query;
  const realMatchId = stripPrefix(matchId);
  const realHomeId = stripPrefix(homeTeamId);
  const realAwayId = stripPrefix(awayTeamId);
  if (!realHomeId || !realAwayId) {
    return res.status(400).json({ available: false, error: "Paramètres manquants (identifiants de joueur)" });
  }

  try {
    const bestOf = determineBestOf(category);

    // Profils réels des deux joueurs (classement, forme, surface, service/retour,
    // fatigue — voir lib/sports/tennis/statProfiles.js) et confrontations directes
    // réelles, en parallèle. La surface transmise (voir components/MatchCard.js)
    // privilégie les vrais matchs récents de chaque joueur sur CETTE surface.
    const [homeProfile, awayProfile, h2hGames] = await Promise.all([
      getOrBuildPlayerProfile({ playerId: realHomeId, playerName: homeTeamName, surface: surface || null, apiKey }),
      getOrBuildPlayerProfile({ playerId: realAwayId, playerName: awayTeamName, surface: surface || null, apiKey }),
      getHeadToHead(realHomeId, realAwayId, apiKey),
    ]);

    const result = computeTennisPronostic({
      homeProfile, awayProfile, homeTeamName, awayTeamName,
      h2hGames, homeId: realHomeId, bestOf, surface: surface || null,
    });

    if (!result.available) return res.status(200).json(result);

    // Le score/l'état du match viennent toujours de l'API, jamais d'une valeur
    // transmise par le client (même principe que pages/api/analyze.js et pages/api/
    // basketball/analyze.js).
    const game = realMatchId ? await getGameById(realMatchId, apiKey) : null;
    const liveMatch = game ? mapMatchToLiveState(game) : null;
    const isLive = liveMatch?.status === "IN_PLAY" || liveMatch?.status === "PAUSED";

    // RECALCUL EN DIRECT (voir PROMPT, "Règle figé/live") : UNIQUEMENT probabilité de
    // victoire, scores en sets probables et totaux de jeux — jamais aces/doubles
    // fautes/breaks/tie-break/handicap, qui restent ceux calculés ci-dessus, figés.
    if (isLive) {
      const liveState = deriveLiveSetsState(liveMatch.sets || []);
      const overlay = computeTennisLiveOverlay({ modelState: result.modelState, bestOf, liveState });
      result.probabilities = overlay.probabilities;
      result.setScores = overlay.setScores;
      result.gameTotals = overlay.gameTotals;
    }

    result.matchStatus = liveMatch?.status || "SCHEDULED";
    result.matchScore = liveMatch?.score?.fullTime || null;
    // Score du jeu en cours ("40-30") et numéro du set en cours ("Set 3") — comme pour
    // la carte (voir components/MatchInfoBlock.js/lib/liveClockFormat.js), affichés
    // tels quels dans l'en-tête du match pendant qu'il est suivi en direct.
    result.matchMinute = liveMatch?.minute || null;
    result.matchPeriod = liveMatch?.period || null;
    result.live = Boolean(isLive);

    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=20");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ available: false, error: e.message });
  }
}
