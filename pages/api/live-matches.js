import { getStandingsTable } from "../../lib/standingsCache";
import { getLiveMatchesList } from "../../lib/liveListCache";
import { getAllLiveFixtures, normalizeTeamName, mapFixtureToLiveMatch } from "../../lib/apiFootball";
import { computePronostic, computeLiveOutcome, buildSelectionCandidates } from "../../lib/pronostic";
import { maybeSweepFinishedPredictions } from "../../lib/pronosticHistory";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

function attachPronostic(m, table) {
  const homeRow = table?.find((row) => String(row.team.id) === String(m.homeTeam?.id));
  const awayRow = table?.find((row) => String(row.team.id) === String(m.awayTeam?.id));
  const pronostic = computePronostic({
    homeRow, awayRow, homeTeamName: m.homeTeam?.name, awayTeamName: m.awayTeam?.name,
  });

  // "Combiné Vision" en direct (voir lib/combinedVision.js) doit s'appuyer sur EXACTEMENT
  // les mêmes probabilités/totaux de buts en direct que la page du match (voir
  // pages/api/analyze.js, même mécanisme computeLiveOutcome) — jamais un calcul
  // parallèle qui afficherait des chiffres différents pour le même match au même
  // instant. Comme partout ailleurs sur le site, le reste (corners, cartons, tirs,
  // hors-jeu, fautes, touches) reste figé sur l'estimation pré-match : seules les
  // sélections qui en dépendent (Issue du match, Total, Total 1, Total 2) sont
  // recalculées ici.
  const currentHome = m.score?.fullTime?.home;
  const currentAway = m.score?.fullTime?.away;
  if (LIVE_STATUSES.includes(m.status) && currentHome != null && currentAway != null) {
    const live = computeLiveOutcome({
      lambdaHome: pronostic.goals.expectedHome,
      lambdaAway: pronostic.goals.expectedAway,
      currentHome, currentAway, minute: m.minute,
    });
    pronostic.live = true;
    pronostic.probabilities = live.probabilities;
    pronostic.correctScores = live.correctScores;
    pronostic.goals = live.goals;
    pronostic.markets = { ...pronostic.markets, ...live.markets };
    pronostic.selectionCandidates = buildSelectionCandidates({
      probabilities: pronostic.probabilities,
      homeTeamName: m.homeTeam?.name,
      awayTeamName: m.awayTeam?.name,
      markets: pronostic.markets,
      extraStats: pronostic.extraStats,
      home: pronostic.home,
      away: pronostic.away,
      goals: pronostic.goals,
    });
  }

  return { ...m, pronostic };
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  // RÈGLEMENT AUTOMATIQUE DE FIN DE MATCH (voir lib/pronosticHistory.js) : la route la
  // plus fréquemment interrogée du site (page d'accueil, actualisée en continu) — un
  // simple appel throttlé (5 min, jamais attendu), sans le moindre coût perceptible ici.
  maybeSweepFinishedPredictions(token, apiFootballKey);

  try {
    // Tous les matchs en direct (IN_PLAY + PAUSED via le pseudo-statut LIVE de
    // football-data.org), sans filtrer par compétition ni par pays, et sans plafond
    // artificiel : on affiche exactement ce que l'API renvoie, jamais plus, jamais moins.
    // getLiveMatchesList mutualise l'appel en amont entre tous les visiteurs (quelques
    // secondes de cache partagé), pour pouvoir actualiser souvent côté client sans
    // dépasser le quota de l'API, même si plusieurs personnes regardent en même temps.
    const listResult = await getLiveMatchesList(token);
    if (listResult.errorStatus) {
      return res.status(listResult.errorStatus).json({ error: `Erreur API football-data (code ${listResult.errorStatus})` });
    }
    // Aucune restriction par ligue, pays, fédération ou catégorie d'âge : toute
    // compétition renvoyée par l'API (y compris jeunes, réserves, petits championnats
    // nationaux) est affichée telle quelle.
    const fdMatches = listResult.matches || [];

    // football-data.org (plan gratuit) ne couvre qu'un nombre limité de compétitions —
    // API-Football (voir lib/apiFootball.js, mis en place au bloc 1 pour les événements)
    // comble ce trou pour respecter "TOUS les matchs en direct dans le monde, sans
    // exception" : on ajoute ses matchs en direct, sans jamais dupliquer un match déjà
    // remonté par football-data.org (comparaison par noms d'équipe normalisés, les deux
    // API n'utilisant pas les mêmes identifiants). Une panne d'API-Football ne doit
    // jamais vider la liste : on garde alors simplement les matchs football-data.org.
    let afMatches = [];
    if (apiFootballKey) {
      try {
        const fixtures = await getAllLiveFixtures(apiFootballKey);
        // Visibilité serveur (logs Vercel) : sans ça, une source qui répond mais ne
        // renvoie rien (quota épuisé, aucun match en ce moment) est indiscernable
        // d'une source qui échoue silencieusement — utile pour diagnostiquer
        // l'absence d'un championnat précis (ex : petite fédération) sans devoir
        // deviner.
        console.log(`[API-Football] /fixtures?live=all : ${fixtures.length} match(s) reçu(s)`);
        const known = new Set(
          fdMatches.map((m) => `${normalizeTeamName(m.homeTeam?.name)}|${normalizeTeamName(m.awayTeam?.name)}`)
        );
        afMatches = fixtures
          .filter((f) => !known.has(`${normalizeTeamName(f?.teams?.home?.name)}|${normalizeTeamName(f?.teams?.away?.name)}`))
          .map(mapFixtureToLiveMatch)
          .filter((m) => m.homeTeam.name && m.awayTeam.name);
      } catch (e) {
        console.error("Erreur liste live API-Football:", e.message);
      }
    }

    const codes = [...new Set(fdMatches.map((m) => m.competition?.code).filter(Boolean))];
    const standingsByCode = {};
    await Promise.all(
      codes.map(async (code) => {
        standingsByCode[code] = await getStandingsTable(code, token);
      })
    );

    const matches = [
      ...fdMatches.map((m) => attachPronostic(m, standingsByCode[m.competition?.code])),
      // Équipes hors du classement football-data.org connu : pronostic non disponible
      // plutôt qu'une estimation fondée sur de mauvaises données (jamais de valeur
      // inventée). Ce champ n'est de toute façon pas encore affiché sur cette liste
      // (voir components/MatchCard.js) — seul le détail du match (ANALYSER) en calcule
      // un, avec son propre repli gracieux (lib/pronostic.js — "estimation moyenne").
      ...afMatches.map((m) => ({ ...m, pronostic: { available: false } })),
    ];

    // Vercel peut exécuter plusieurs instances de cette fonction en parallèle sous
    // charge : le cache en mémoire (liveListCache.js) n'est alors PAS partagé entre
    // elles (chacune a sa propre mémoire), et chacune referait son propre appel en
    // amont. Cet en-tête fait que le réseau Vercel (CDN, devant toutes les instances)
    // sert la même réponse à tout le monde pendant quelques secondes, quel que soit
    // le nombre d'instances — c'est ce qui borne réellement le nombre d'appels à
    // l'API football-data.org, plus fiable que le cache en mémoire seul.
    res.setHeader("Cache-Control", "s-maxage=3, stale-while-revalidate=20");
    return res.status(200).json({ matches });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
