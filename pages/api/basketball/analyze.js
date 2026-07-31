// Bloc 3 (multi-sport) — équivalent basket de pages/api/analyze.js : croise les
// profils réels des deux équipes (lib/sports/basketball/statProfiles.js) pour
// produire toutes les lignes de pronostic (lib/sports/basketball/pronosticModel.js)
// et le bloc "Joueurs à suivre" (lib/sports/basketball/playerProps.js).
//
// Contrairement au football, aucune persistance Supabase ici (voir statProfiles.js :
// cache mémoire 24h) : le pronostic est recalculé à chaque appel à partir du même
// profil en cache, jamais lu depuis un pronostic figé en base — les blocs figés
// (rebonds/passes/3 points/fautes/ballons perdus/lancers francs/périodes) restent
// néanmoins stables tant que le profil en cache ne change pas (24h), ce qui suffit à
// tenir la promesse "référence stable pendant toute la durée du match" du PROMPT.
import { getBasketballApiKey, getGameById, getTeamPlayerStatistics } from "../../../lib/sports/basketball/provider";
import { mapGameStatusToBlumeStatus } from "../../../lib/sports/basketball/mapper";
import { getOrRefreshTeamProfile } from "../../../lib/sports/basketball/statProfiles";
import { computeBasketballPronostic } from "../../../lib/sports/basketball/pronosticModel";
import { buildPlayerProps } from "../../../lib/sports/basketball/playerProps";

// Les ids transmis par components/MatchCard.js#matchHref portent le préfixe "bk-"
// (voir lib/sports/basketball/mapper.js) — jamais envoyés tels quels à l'API, qui
// attend ses propres ids numériques.
function stripPrefix(id) {
  if (typeof id !== "string") return null;
  const n = id.startsWith("bk-") ? id.slice(3) : id;
  return n || null;
}

const QUARTER_KEYS = ["quarter_1", "quarter_2", "quarter_3", "quarter_4"];

// Fraction du match RESTANT à jouer, utilisée par computeBasketballPronostic pour
// faire suivre probabilité/scores/totaux au score réel en cours (voir PROMPT,
// règle figé/live). Le chrono officiel (`status.timer`) est un compte à rebours
// dans le quart-temps courant, mais sa durée totale varie selon la ligue (12 min en
// NBA, 10 min FIBA...) — plutôt que de supposer une durée, on se base sur le nombre
// de quart-temps DÉJÀ complets (leurs scores sont renseignés dans `game.scores`),
// une donnée fiable quelle que soit la ligue : un repère plus grossier, mais jamais
// faux. Un quart-temps en cours compte pour une moitié de sa part (approximation
// honnête du "milieu de quart-temps" faute de mieux).
function computeRemainingFraction(game, status) {
  const home = game?.scores?.home || {};
  const quartersCompleted = QUARTER_KEYS.filter((k) => Number.isFinite(home[k])).length;
  if (status === "PAUSED") {
    return Math.max(0.03, 1 - quartersCompleted / 4);
  }
  if (status === "IN_PLAY") {
    if (game?.status?.short === "OT") return 0.05;
    const elapsed = Math.min(0.97, quartersCompleted / 4 + 0.125);
    return Math.max(0.03, 1 - elapsed);
  }
  return 1;
}

export default async function handler(req, res) {
  const apiKey = getBasketballApiKey();
  if (!apiKey) return res.status(500).json({ available: false, error: "Clé API basket manquante" });

  const { matchId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, season: seasonParam } = req.query;
  const realMatchId = stripPrefix(matchId);
  const realHomeTeamId = stripPrefix(homeTeamId);
  const realAwayTeamId = stripPrefix(awayTeamId);
  if (!realHomeTeamId || !realAwayTeamId) {
    return res.status(400).json({ available: false, error: "Paramètres manquants (identifiants d'équipe)" });
  }

  try {
    const game = realMatchId ? await getGameById(realMatchId, apiKey) : null;
    // La saison vient normalement de l'URL (voir components/MatchCard.js#matchHref) ;
    // repli sur celle du match lui-même si elle manque, jamais une saison devinée.
    const season = seasonParam || (game?.league?.season != null ? String(game.league.season) : null);
    if (!season) {
      return res.status(200).json({ available: false, reason: "saison introuvable pour ce match" });
    }

    const [homeProfile, awayProfile, homePlayers, awayPlayers] = await Promise.all([
      getOrRefreshTeamProfile({ teamId: realHomeTeamId, teamName: homeTeamName, season, apiKey }),
      getOrRefreshTeamProfile({ teamId: realAwayTeamId, teamName: awayTeamName, season, apiKey }),
      getTeamPlayerStatistics({ team: realHomeTeamId, season }, apiKey),
      getTeamPlayerStatistics({ team: realAwayTeamId, season }, apiKey),
    ]);

    if (!homeProfile.available || !awayProfile.available) {
      return res.status(200).json({
        available: false,
        reason: !homeProfile.available ? homeProfile.reason : awayProfile.reason,
      });
    }

    const status = game ? mapGameStatusToBlumeStatus(game.status?.short) : "SCHEDULED";
    const isLive = status === "IN_PLAY" || status === "PAUSED";
    const liveOffset = isLive
      ? {
          home: game.scores?.home?.total ?? 0,
          away: game.scores?.away?.total ?? 0,
          remainingFraction: computeRemainingFraction(game, status),
        }
      : null;

    const result = computeBasketballPronostic({ homeProfile, awayProfile, homeTeamName, awayTeamName, liveOffset });
    if (!result.available) return res.status(200).json(result);

    result.players = buildPlayerProps({ homeRows: homePlayers, awayRows: awayPlayers });

    // "Par période" (PROMPT, bloc 5) : le libellé bascule de "1ère mi-temps" à "2ème
    // mi-temps" dès que 2 quart-temps sont déjà complets (ou le match terminé) —
    // jamais avant. La ligne FIGÉE elle-même (firstHalfTotal/secondHalfTotal) ne
    // change jamais : seul l'affichage choisit laquelle montrer.
    const home = game?.scores?.home || {};
    const quartersCompleted = QUARTER_KEYS.filter((k) => Number.isFinite(home[k])).length;
    const firstHalfOver = status === "FINISHED" || quartersCompleted >= 2;
    result.periods.activeHalfLabel = firstHalfOver ? "Total 2ème mi-temps" : "Total 1ère mi-temps";
    result.periods.activeHalf = firstHalfOver ? result.periods.secondHalf : result.periods.firstHalf;

    result.matchStatus = status;
    result.matchScore = game ? { home: game.scores?.home?.total ?? null, away: game.scores?.away?.total ?? null } : null;
    result.live = isLive;

    res.setHeader("Cache-Control", "s-maxage=3, stale-while-revalidate=20");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ available: false, error: e.message });
  }
}
